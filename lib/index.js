/**
 * Skill GoGo —— 宿主半区（Host half）。
 *
 * 职责：
 *   1. 通过 `ctx.skills` 读取 skill 目录（含项目级 `<cwd>/.dsh/skills`）。
 *   2. 把用户补充的目录注册成 skill 提供方，让模型与 `/名字` 调用同样能用上。
 *   3. 通过 `ctx.workspaceRegistry` 提供工作区列表，供 UI 选择"在哪个工作区里看 skill"。
 *   4. 持久化"分类库"（文件夹 / skill 归属 / 补充目录）到 `$DSH_HOME/skill-gogo.json`。
 *   5. 提供 `/skill-gogo/api/*` HTTP 接口：目录 / 详情 / 文件预览 / zip 下载 / 复制到项目 /
 *      分类库 / 目录浏览。
 *
 * 浏览器半区（lib/client.js）是官方 client 插件：注册 `sidebar.panellist` 图标与
 * `main` 键控面板，面板通过同源 fetch 调用这里的接口。
 *
 * 安全：所有路由都套一层"信任栅栏"（回环地址 + 同源 + 可委托宿主栅栏），
 * 写操作额外只允许回环来源；任何异常一律按拒绝处理（fail-closed）。
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  buildSkillZip,
  listSkillFiles,
  readSkillFile,
  skillDirectory,
  sourceLabel,
  toCatalogRows,
} from './skills.mjs'
import {
  FOLDER_COLORS,
  emptyLibrary,
  libraryPath,
  patchLibrary,
  readLibrary,
} from './library.mjs'
import { createCustomDirsProvider, describeDirs } from './customdirs.mjs'

const VERSION = '0.3.0'
const ROUTE_BASE = '/skill-gogo'
const MAX_BODY_BYTES = 64 * 1024


const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.dirname(HERE)

function readPackageVersion() {
  try {
    const raw = fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed.version === 'string' ? parsed.version : VERSION
  } catch {
    return VERSION
  }
}

const PKG_VERSION = readPackageVersion()

function log(...args) {
  try {
    console.log('[skill-gogo]', ...args)
  } catch {
    /* 日志永远不能影响插件 */
  }
}

function warn(...args) {
  try {
    console.warn('[skill-gogo]', ...args)
  } catch {
    /* 同上 */
  }
}

/* ------------------------------------------------------------------ *
 * HTTP 小工具
 * ------------------------------------------------------------------ */

function sendJson(res, code, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length),
    ...extraHeaders,
  })
  res.end(body)
}

function sendText(res, code, text) {
  const body = Buffer.from(String(text), 'utf8')
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length),
  })
  res.end(body)
}

/** RFC 5987 的 filename* 值（非 ASCII 文件名下载时用）。 */
function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object')
  return parsed
}

/* ------------------------------------------------------------------ *
 * 信任栅栏
 * ------------------------------------------------------------------ */

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  if (Number(m[1]) !== 127) return false
  return [m[2], m[3], m[4]].every((x) => Number(x) <= 255 && x !== '')
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * @returns {number|null} 应拒绝的 HTTP 状态码；null 表示放行。
 */
function trustRejection(ctx, req, trustedAuthorities) {
  try {
    const headers = (req && req.headers) || {}
    let hostUrl
    try {
      hostUrl = new URL('http://' + String(headers.host || ''))
    } catch {
      return 403
    }
    const hostname = hostUrl.hostname
    const authority = hostUrl.host.toLowerCase()

    if (!isLoopbackHostname(hostname)) {
      const conn = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : null
      const fenceAvailable = !!(conn && typeof conn.requestRejection === 'function')
      const listed = trustedAuthorities.some((entry) =>
        entry.indexOf(':') >= 0 ? entry === authority : entry === hostname.toLowerCase(),
      )
      if (!listed && !fenceAvailable) return 403
    }

    const site = String(headers['sec-fetch-site'] || '').toLowerCase()
    if (site === 'cross-site') return 403

    const origin = headers.origin
    if (typeof origin === 'string' && origin && origin !== 'null') {
      let originUrl
      try {
        originUrl = new URL(origin)
      } catch {
        return 403
      }
      if (originUrl.host.toLowerCase() !== authority) return 403
    }

    // 写操作只认回环/显式信任的权威，避免被反代或跨站触发
    if (WRITE_METHODS.has(String(req.method || 'GET').toUpperCase())) {
      if (!isLoopbackHostname(hostname) && !trustedAuthorities.includes(authority)) return 403
    }

    const conn = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : null
    if (conn && typeof conn.requestRejection === 'function') {
      let code
      try {
        code = conn.requestRejection(req)
      } catch (err) {
        warn('宿主信任栅栏抛异常，已按拒绝处理：' + String((err && err.message) || err))
        return 403
      }
      if (code !== undefined && code !== null && code !== false) {
        return typeof code === 'number' ? code : 403
      }
    }
    return null
  } catch {
    return 403
  }
}

/* ------------------------------------------------------------------ *
 * 数据访问
 * ------------------------------------------------------------------ */

function skillService(ctx) {
  try {
    const svc = typeof ctx.get === 'function' ? ctx.get('skills') : null
    return svc && typeof svc.snapshot === 'function' ? svc : null
  } catch {
    return null
  }
}

/**
 * 查看 scope 候选，按"最近层优先"排列。
 *
 * 注册表把提供方按注册上下文的 scope 分层：宿主根上下文注册的进全局层，
 * agent preset 挂载的进该 preset 的层。只读全局层会漏掉 preset 层的提供方
 * （例如把 skill-filesystem 挂在 preset 里的组合），因此这里额外用活跃 agent
 * 作为 scope 再查一次——它的结果本身已经包含全局层，故排在最前。
 */
function scopeCandidates(ctx, cwd) {
  const options = {}
  if (cwd) options.cwd = cwd
  const list = []
  try {
    const agents = typeof ctx.get === 'function' ? ctx.get('agents') : null
    if (agents && typeof agents.list === 'function') {
      for (const agent of agents.list().slice(0, 4)) {
        if (agent) list.push({ ...options, scope: agent })
      }
    }
  } catch {
    /* agents 服务不存在时只用全局层 */
  }
  list.push({ ...options })
  return list
}

async function readCatalog(ctx, cwd, signal) {
  const svc = skillService(ctx)
  if (!svc) {
    return { available: false, complete: false, skills: [] }
  }
  const merged = new Map()
  let complete = true
  let any = false
  for (const options of scopeCandidates(ctx, cwd)) {
    let snapshot
    try {
      snapshot = await svc.snapshot({ ...options, signal })
    } catch (err) {
      if (!any) throw err
      continue
    }
    any = true
    if (snapshot.complete === false) complete = false
    for (const row of snapshot.skills) if (!merged.has(row.name)) merged.set(row.name, row)
  }
  return { available: true, complete, skills: toCatalogRows([...merged.values()]) }
}

async function readSkill(ctx, name, cwd, signal) {
  const svc = skillService(ctx)
  if (!svc) throw new Error('skills 服务不可用（@deepseek-ai/dsh-skill 未启用）')
  let definition
  let lastError = null
  for (const options of scopeCandidates(ctx, cwd)) {
    try {
      definition = await svc.get(name, { ...options, signal })
    } catch (err) {
      lastError = err
      continue
    }
    if (definition) break
  }
  if (!definition) {
    if (lastError) throw lastError
    throw new Error(`找不到 skill：${name}`)
  }
  const rows = toCatalogRows([definition])
  const row = rows[0] || { name, description: '', source: 'unknown', provider: 'unknown' }
  const dir = skillDirectory(definition)
  let files = []
  let truncated = false
  if (dir) {
    try {
      const listing = await listSkillFiles(dir)
      files = listing.files.map((f) => ({ path: f.rel, size: f.size }))
      truncated = listing.truncated
    } catch (err) {
      warn('列举 skill 目录失败：' + String((err && err.message) || err))
    }
  }
  return {
    skill: {
      ...row,
      content: typeof definition.content === 'string' ? definition.content : '',
      metadata: definition.metadata || null,
    },
    files,
    truncated,
    dir,
  }
}

function readWorkspaces(ctx) {
  try {
    const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
    if (!registry || typeof registry.list !== 'function') return []
    const list = registry.list()
    if (!Array.isArray(list)) return []
    return list
      .filter((w) => w && typeof w.path === 'string')
      .map((w) => ({
        id: String(w.id ?? w.path),
        title: typeof w.title === 'string' && w.title ? w.title : w.path,
        path: w.path,
      }))
  } catch {
    return []
  }
}

function summarizeSources(rows) {
  const counts = new Map()
  for (const row of rows) counts.set(row.source, (counts.get(row.source) || 0) + 1)
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: sourceLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** 复制 skill 到项目级 skill 根 `<projectRoot>/.dsh/skills/<name>/`。 */
async function installIntoProject(sourceDir, projectPath, name) {
  const target = path.join(projectPath, '.dsh', 'skills', name)
  if (fs.existsSync(target)) throw new Error(`目标已存在，未覆盖：${target}`)
  const { files } = await listSkillFiles(sourceDir)
  if (!files.length) throw new Error('该 skill 没有可读取的文件')
  for (const file of files) {
    const from = path.join(sourceDir, file.rel)
    const to = path.join(target, file.rel)
    await fsp.mkdir(path.dirname(to), { recursive: true })
    await fsp.copyFile(from, to)
  }
  return { target, fileCount: files.length }
}

/* ------------------------------------------------------------------ *
 * 目录浏览（给面板的"添加目录"对话框用）
 * ------------------------------------------------------------------ */

async function looksLikeSkillDir(dir) {
  try {
    return (await fsp.stat(path.join(dir, 'SKILL.md'))).isFile()
  } catch {
    return false
  }
}

function defaultBrowseRoot(ctx) {
  const list = readWorkspaces(ctx)
  if (list.length && fs.existsSync(list[0].path)) return list[0].path
  return os.homedir()
}

async function listDirectories(ctx, target) {
  const dir = target && String(target).trim() ? path.resolve(String(target).trim()) : defaultBrowseRoot(ctx)
  const stat = await fsp.stat(dir)
  if (!stat.isDirectory()) throw new Error('不是目录：' + dir)
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    rows.push({ name: entry.name, path: abs, hasSkill: await looksLikeSkillDir(abs) })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  const parent = path.dirname(dir)
  return { path: dir, parent: parent === dir ? null : parent, entries: rows }
}

/* ------------------------------------------------------------------ *
 * 在本地文件管理器里显示
 * ------------------------------------------------------------------ */

/**
 * 用系统文件管理器打开（Windows 资源管理器 / macOS Finder / Linux 文件管理器）。
 * 传文件路径时在所在目录中选中它；传目录时直接打开该目录。
 *
 * `SKILLGOGO_REVEAL_DRY_RUN=1` 时只算目标、不真正拉起窗口（给自动化测试用）。
 */
function revealInFileManager(target, selectMode) {
  const platform = process.platform
  let command
  let args
  if (platform === 'win32') {
    command = 'explorer.exe'
    args = selectMode ? [`/select,${target}`] : [target]
  } else if (platform === 'darwin') {
    command = 'open'
    args = selectMode ? ['-R', target] : [target]
  } else {
    command = 'xdg-open'
    args = [selectMode ? path.dirname(target) : target]
  }

  if (process.env.SKILLGOGO_REVEAL_DRY_RUN === '1') {
    return { command, args, dryRun: true }
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', (err) => warn('打开文件管理器失败：' + String((err && err.message) || err)))
  child.unref()
  return { command, args, dryRun: false }
}

/* ------------------------------------------------------------------ *
 * 重命名 skill
 * ------------------------------------------------------------------ */

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 只替换 frontmatter 里的 name 行，其余字节原样保留（含 CRLF 风格）。 */
export function rewriteFrontmatterName(text, newName) {
  if (typeof text !== 'string') return null
  const crlf = text.includes('\r\n')
  const normalized = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---\n')) return null
  const end = normalized.indexOf('\n---', 3)
  if (end < 0) return null

  const lines = normalized.slice(4, end + 1).split('\n')
  let replaced = false
  for (let i = 0; i < lines.length; i += 1) {
    if (/^name:\s*/.test(lines[i])) {
      lines[i] = 'name: ' + newName
      replaced = true
      break
    }
  }
  if (!replaced) lines.unshift('name: ' + newName)
  // body 以换行结尾（slice 含最后一行的 \n），所以直接拼 '---' 即可
  const out = '---\n' + lines.join('\n') + '---' + normalized.slice(end + 4)
  return crlf ? out.replace(/\n/g, '\r\n') : out
}

/** 原子写文本文件（同目录临时文件 + rename）。 */
async function writeTextAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(tmp, text, 'utf8')
  try {
    await fsp.rename(tmp, file)
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

function isInsideAsar(file) {
  return /[\\/]app\.asar[\\/]/i.test(file)
}

/**
 * 重命名一个本地 skill：
 *   1. 改 SKILL.md frontmatter 的 `name`；
 *   2. 目录型 bundle 且目录名等于旧名字时，顺手把目录改名；平铺 `<name>.md` 同理改文件名；
 *   3. 调用方负责把分类库里的归属键从旧名字迁到新名字。
 *
 * @returns {{file: string, pathRenamed: string|null, warnings: string[]}}
 */
async function renameSkillOnDisk(detail, newName, options) {
  const oldName = detail.skill.name
  const originalFile = detail.skill.path
  if (!originalFile) throw new Error('该 skill 没有本地文件，无法重命名')
  if (isInsideAsar(originalFile)) throw new Error('内置 skill 位于应用包内（app.asar），无法重命名')

  let file = originalFile
  let pathRenamed = null
  const warnings = []
  const wantsPathRename = !options || options.renamePath !== false

  if (wantsPathRename) {
    const base = path.basename(file)
    const dir = path.dirname(file)
    if (base.toLowerCase() === 'skill.md' && path.basename(dir) === oldName) {
      const target = path.join(path.dirname(dir), newName)
      if (!fs.existsSync(target)) {
        try {
          await fsp.rename(dir, target)
          pathRenamed = target
          file = path.join(target, base)
        } catch (err) {
          warnings.push('目录改名失败（已保留原目录，仅修改名称字段）：' + String((err && err.message) || err))
        }
      } else {
        warnings.push('同名目录已存在，已保留原目录，仅修改名称字段')
      }
    } else if (/\.md$/i.test(base) && base.slice(0, -3) === oldName) {
      const target = path.join(dir, newName + '.md')
      if (!fs.existsSync(target)) {
        try {
          await fsp.rename(file, target)
          pathRenamed = target
          file = target
        } catch (err) {
          warnings.push('文件改名失败（已保留原文件，仅修改名称字段）：' + String((err && err.message) || err))
        }
      } else {
        warnings.push('同名文件已存在，已保留原文件，仅修改名称字段')
      }
    }
  }

  const text = await fsp.readFile(file, 'utf8')
  const next = rewriteFrontmatterName(text, newName)
  if (next === null) throw new Error('无法解析 SKILL.md 的 frontmatter，未做任何修改')
  if (next !== text) await writeTextAtomic(file, next)

  return { file, pathRenamed, warnings }
}

/* ------------------------------------------------------------------ *
 * 插件主体
 * ------------------------------------------------------------------ */

export default {
  name: 'skill-gogo',
  apply(root) {
    const trustedAuthorities = String(process.env.DSKILLGOGO_TRUSTED_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)

    /** 插件共享状态：分类库 + 补充目录 + 提供方失效句柄。 */
    const store = {
      library: emptyLibrary(),
      invalidate: () => {},
    }

    // ① 分类库：启动即读，供提供方与接口共用
    readLibrary()
      .then((library) => {
        store.library = library
        store.invalidate()
        if (library.dirs.length) log(`补充目录 ${library.dirs.length} 个已生效`)
      })
      .catch((err) => warn('读取分类库失败：' + String((err && err.message) || err)))

    // ② 把补充目录注册成 skill 提供方（全局层，rank 250：项目根之后、用户根之前）
    root.inject(['skills'], (ctx) => {
      const skills = typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills
      if (!skills || typeof skills.registerProvider !== 'function') {
        warn('skills 服务不可用，补充目录暂不生效')
        return
      }
      let control = null
      const dispose = skills.registerProvider((providerControl) => {
        control = providerControl
        return createCustomDirsProvider({ getDirs: () => store.library.dirs })(providerControl)
      })
      store.invalidate = () => {
        try {
          if (control && typeof control.invalidate === 'function') control.invalidate()
        } catch (err) {
          warn('提供方失效失败：' + String((err && err.message) || err))
        }
      }
      root.effect(
        () => () => {
          store.invalidate = () => {}
          control = null
          try {
            dispose()
          } catch {
            /* 释放失败不影响其它注册 */
          }
        },
      )
      log('补充目录提供方已注册（rank 250）')
    })

    root.inject(['webServer'], (ctx) => {
      const disposers = []

      const register = (kind, routePath, handler) => {
        const dispose = ctx.webServer.register({
          kind,
          path: routePath,
          handler: async (req, res) => {
            const denied = trustRejection(ctx, req, trustedAuthorities)
            if (denied !== null) {
              sendText(res, denied, 'skill-gogo: request rejected')
              return
            }
            try {
              await handler(req, res)
            } catch (err) {
              const message = String((err && err.message) || err)
              warn('接口失败 ' + routePath + '：' + message)
              if (!res.headersSent) sendJson(res, 500, { ok: false, error: message })
              else res.end()
            }
          },
        })
        disposers.push(dispose)
        return dispose
      }

      register('exact', `${ROUTE_BASE}/api/ping`, async (req, res) => {
        const svc = skillService(ctx)
        sendJson(res, 200, {
          ok: true,
          plugin: 'skill-gogo',
          version: PKG_VERSION,
          skillsService: !!svc,
          libraryPath: libraryPath(),
          routes: [
            `${ROUTE_BASE}/api/ping`,
            `${ROUTE_BASE}/api/state`,
            `${ROUTE_BASE}/api/skill`,
            `${ROUTE_BASE}/api/file`,
            `${ROUTE_BASE}/api/export`,
            `${ROUTE_BASE}/api/install`,
            `${ROUTE_BASE}/api/library`,
            `${ROUTE_BASE}/api/dirs`,
            `${ROUTE_BASE}/api/dirs/list`,
            `${ROUTE_BASE}/api/rescan`,
            `${ROUTE_BASE}/api/reveal`,
            `${ROUTE_BASE}/api/rename`,
          ],
        })
      })


      register('exact', `${ROUTE_BASE}/api/state`, async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const cwd = url.searchParams.get('cwd') || undefined
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        const catalog = await readCatalog(ctx, cwd, controller.signal)
        const rows = catalog.skills
        sendJson(res, 200, {
          ok: true,
          plugin: 'skill-gogo',
          version: PKG_VERSION,
          generatedAt: new Date().toISOString(),
          cwd: cwd || null,
          skillsAvailable: catalog.available,
          complete: catalog.complete,
          skills: rows,
          sources: summarizeSources(rows),
          workspaces: readWorkspaces(ctx),
          library: store.library,
          folderColors: FOLDER_COLORS,
          dirStatus: await describeDirs(store.library.dirs),
          counts: {
            total: rows.length,
            modelInvocable: rows.filter((r) => r.modelInvocable).length,
            userInvocable: rows.filter((r) => r.userInvocable).length,
            exportable: rows.filter((r) => !!r.dir).length,
          },
        })
      })

      /* 分类库：读 / 写（文件夹、归属、补充目录） */
      register('exact', `${ROUTE_BASE}/api/library`, async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'GET') {
          sendJson(res, 200, { ok: true, library: store.library, file: libraryPath(), colors: FOLDER_COLORS })
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '请使用 GET 或 POST' })
          return
        }
        const body = await readJsonBody(req)
        const patch = {}
        if (body.folders !== undefined) patch.folders = body.folders
        if (body.assignments !== undefined) patch.assignments = body.assignments
        if (body.dirs !== undefined) patch.dirs = body.dirs
        if (!Object.keys(patch).length) {
          sendJson(res, 400, { ok: false, error: '没有可保存的字段（folders / assignments / dirs）' })
          return
        }
        if (patch.dirs !== undefined && !Array.isArray(patch.dirs)) {
          sendJson(res, 400, { ok: false, error: 'dirs 必须是字符串数组' })
          return
        }
        const saved = await patchLibrary(patch)
        store.library = saved
        if (patch.dirs !== undefined) store.invalidate()
        sendJson(res, 200, { ok: true, library: saved, dirStatus: await describeDirs(saved.dirs) })
      })

      /* 补充目录状态 */
      register('exact', `${ROUTE_BASE}/api/dirs`, async (req, res) => {
        sendJson(res, 200, { ok: true, dirs: await describeDirs(store.library.dirs), max: 20 })
      })

      /* 目录浏览（添加目录对话框） */
      register('exact', `${ROUTE_BASE}/api/dirs/list`, async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const listing = await listDirectories(ctx, url.searchParams.get('path'))
        sendJson(res, 200, { ok: true, ...listing })
      })

      /* 手动重扫（补充目录内容变化、或宿主目录被外部改动后） */
      register('exact', `${ROUTE_BASE}/api/rescan`, async (req, res) => {
        if (String(req.method || '').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '请使用 POST' })
          return
        }
        store.invalidate()
        sendJson(res, 200, { ok: true, dirs: await describeDirs(store.library.dirs) })
      })

      register('exact', `${ROUTE_BASE}/api/skill`, async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const name = url.searchParams.get('name')
        if (!name) {
          sendJson(res, 400, { ok: false, error: '缺少 name 参数' })
          return
        }
        const cwd = url.searchParams.get('cwd') || undefined
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        const detail = await readSkill(ctx, name, cwd, controller.signal)
        sendJson(res, 200, { ok: true, ...detail })
      })

      register('exact', `${ROUTE_BASE}/api/file`, async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const name = url.searchParams.get('name')
        const rel = url.searchParams.get('path')
        if (!name || !rel) {
          sendJson(res, 400, { ok: false, error: '缺少 name / path 参数' })
          return
        }
        const cwd = url.searchParams.get('cwd') || undefined
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        const detail = await readSkill(ctx, name, cwd, controller.signal)
        if (!detail.dir) {
          sendJson(res, 404, { ok: false, error: '该 skill 没有可读取的本地目录' })
          return
        }
        const file = await readSkillFile(detail.dir, rel)
        sendJson(res, 200, { ok: true, file })
      })

      register('exact', `${ROUTE_BASE}/api/export`, async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const name = url.searchParams.get('name')
        if (!name) {
          sendJson(res, 400, { ok: false, error: '缺少 name 参数' })
          return
        }
        const cwd = url.searchParams.get('cwd') || undefined
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        const detail = await readSkill(ctx, name, cwd, controller.signal)
        if (!detail.dir) {
          sendJson(res, 404, { ok: false, error: '该 skill 没有可打包的本地目录' })
          return
        }
        const zip = await buildSkillZip(
          { name: detail.skill.name, description: detail.skill.description, source: detail.skill.source, provider: detail.skill.provider, invocation: { modelInvocable: detail.skill.modelInvocable, userInvocable: detail.skill.userInvocable }, whenToUse: detail.skill.whenToUse, path: detail.skill.path, resourceBase: { kind: 'directory', path: detail.dir } },
          { prefix: detail.skill.name },
        )
        const filename = `${detail.skill.name}-skill.zip`
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': contentDisposition(filename),
          'Cache-Control': 'no-store',
          'Content-Length': String(zip.bytes.length),
        })
        res.end(Buffer.from(zip.bytes))
      })

      register('exact', `${ROUTE_BASE}/api/install`, async (req, res) => {
        if (String(req.method || '').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '请使用 POST' })
          return
        }
        const body = await readJsonBody(req)
        const name = typeof body.name === 'string' ? body.name : ''
        const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : ''
        if (!name || !cwd) {
          sendJson(res, 400, { ok: false, error: '缺少 name / cwd' })
          return
        }
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        const detail = await readSkill(ctx, name, cwd, controller.signal)
        if (!detail.dir) {
          sendJson(res, 404, { ok: false, error: '该 skill 没有可复制的本地目录' })
          return
        }
        const result = await installIntoProject(detail.dir, cwd, name)
        sendJson(res, 200, { ok: true, ...result })
      })

      /* 在本地文件管理器里显示：优先在目录中选中 SKILL.md，没有文件就打开 skill 目录 */
      register('exact', `${ROUTE_BASE}/api/reveal`, async (req, res) => {
        if (String(req.method || '').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '请使用 POST' })
          return
        }
        const body = await readJsonBody(req)
        const name = typeof body.name === 'string' ? body.name : ''
        const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : ''
        if (!name) {
          sendJson(res, 400, { ok: false, error: '缺少 name' })
          return
        }
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        const detail = await readSkill(ctx, name, cwd, controller.signal)
        const filePath = typeof detail.skill.path === 'string' && detail.skill.path ? detail.skill.path : null
        const useFile = !!(filePath && fs.existsSync(filePath))
        const target = useFile ? filePath : detail.dir || null
        if (!target) {
          sendJson(res, 404, { ok: false, error: '该 skill 没有本地文件（URL / opaque 型 skill 无法在本地显示）' })
          return
        }
        if (!fs.existsSync(target)) {
          sendJson(res, 404, { ok: false, error: '本地路径不存在：' + target })
          return
        }
        const launched = revealInFileManager(target, useFile)
        sendJson(res, 200, {
          ok: true,
          revealed: target,
          mode: launched.args[0] && String(launched.args[0]).startsWith('/select') ? 'select' : 'open',
          platform: process.platform,
          dryRun: launched.dryRun === true,
        })
      })

      /* 重命名 skill：改 frontmatter + 可选改目录/文件名 + 迁移分类归属 */
      register('exact', `${ROUTE_BASE}/api/rename`, async (req, res) => {
        if (String(req.method || '').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: '请使用 POST' })
          return
        }
        const body = await readJsonBody(req)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        const newName = typeof body.newName === 'string' ? body.newName.trim() : ''
        const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : ''
        if (!name || !newName) {
          sendJson(res, 400, { ok: false, error: '缺少 name / newName' })
          return
        }
        if (!SKILL_NAME_RE.test(newName) || newName.length > 60) {
          sendJson(res, 400, { ok: false, error: '新名称必须是 kebab-case（小写字母/数字，用 - 连接），不超过 60 字符' })
          return
        }
        if (newName === name) {
          sendJson(res, 400, { ok: false, error: '新名称与原名相同' })
          return
        }
        const controller = new AbortController()
        req.on('close', () => controller.abort())
        const detail = await readSkill(ctx, name, cwd, controller.signal)

        const catalog = await readCatalog(ctx, cwd, controller.signal)
        const clash = catalog.skills.find((skill) => skill.name === newName)
        if (clash) {
          sendJson(res, 409, { ok: false, error: `已存在同名 skill：${newName}（来源 ${clash.source}）` })
          return
        }

        const result = await renameSkillOnDisk(detail, newName, { renamePath: body.renamePath !== false })

        let library = store.library
        if (store.library.assignments && store.library.assignments[name] !== undefined) {
          const assignments = Object.assign({}, store.library.assignments)
          assignments[newName] = assignments[name]
          delete assignments[name]
          library = await patchLibrary({ assignments })
          store.library = library
        }

        sendJson(res, 200, {
          ok: true,
          oldName: name,
          name: newName,
          file: result.file,
          pathRenamed: result.pathRenamed,
          warnings: result.warnings,
          library,
        })
      })

      root.effect(
        () => () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              /* 释放失败不影响其它路由 */
            }
          }
        },
      )

      log(`已挂载 ${ROUTE_BASE}/api/*（v${PKG_VERSION}）`)
    })
  },
}
