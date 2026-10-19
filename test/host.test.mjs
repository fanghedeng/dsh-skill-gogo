/**
 * 宿主半区集成测试：用假的 Cordis ctx 把插件挂到一个真实的 node:http 服务上，
 * 然后像浏览器那样请求每个接口，验证数据、zip、写操作与信任栅栏。
 *
 *   node test/host.test.mjs
 */

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import plugin from '../lib/index.js'
import { listZipEntries, readZipEntry } from '../lib/zip.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// 隔离插件自己的持久化：分类库写到临时 DSH_HOME，绝不碰真实的 ~/.dsh
const TEST_HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'skill-gogo-home-'))
process.env.DSH_HOME = TEST_HOME
// 「在本地显示文件」只算目标、不真的拉起资源管理器
process.env.SKILLGOGO_REVEAL_DRY_RUN = '1'

const HOME = TEST_HOME

// 造一个"用户目录 skill"，让目录/详情/导出等断言有稳定输入
await fsp.mkdir(path.join(HOME, 'skills', 'life-decision-guide'), { recursive: true })
await fsp.writeFile(
  path.join(HOME, 'skills', 'life-decision-guide', 'SKILL.md'),
  '---\nname: life-decision-guide\ndescription: 测试用用户目录 skill\nwhenToUse: 单元测试\n---\n\n# 正文\n\n' + 'x'.repeat(2000) + '\n',
  'utf8',
)
await fsp.writeFile(path.join(HOME, 'skills', 'life-decision-guide', 'README.md'), '# readme\n', 'utf8')
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''))
}

/* ---------------- 假 skills 服务：扫描真实目录 ---------------- */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out = {}
  if (!match) return out
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

async function scanRoot(root, source) {
  const rows = []
  let entries = []
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return rows
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const dir = path.join(root, entry.name)
    const file = entry.isDirectory() ? path.join(dir, 'SKILL.md') : path.join(root, entry.name)
    try {
      const text = await fsp.readFile(file, 'utf8')
      const fm = parseFrontmatter(text)
      const name = fm.name || entry.name.replace(/\.md$/, '')
      rows.push({
        name,
        description: fm.description || '',
        whenToUse: fm.whenToUse,
        invocation: { modelInvocable: true, userInvocable: true },
        source,
        provider: 'filesystem',
        path: file,
        resourceBase: { kind: 'directory', path: path.dirname(file) },
        body: text,
      })
    } catch {
      /* 忽略读不到的文件 */
    }
  }
  return rows
}

const providers = []
const skillsService = {
  registerProvider(factory) {
    const provider = factory({ signal: new AbortController().signal, invalidate: () => {} })
    providers.push(provider)
    return () => {
      const at = providers.indexOf(provider)
      if (at >= 0) providers.splice(at, 1)
    }
  },
  async snapshot(options = {}) {
    const user = await scanRoot(path.join(HOME, 'skills'), 'user-dsh')
    const project = options.cwd ? await scanRoot(path.join(options.cwd, '.dsh', 'skills'), 'project-dsh') : []
    const merged = new Map()
    for (const row of [...project, ...user]) if (!merged.has(row.name)) merged.set(row.name, row)
    // 运行期注册的提供方（补充目录）也算进来
    for (const provider of providers) {
      const result = await provider.list(options)
      const candidates = Array.isArray(result) ? result : result.candidates
      for (const candidate of candidates) {
        if (merged.has(candidate.name)) continue
        merged.set(candidate.name, {
          ...candidate,
          path: candidate.locator ? candidate.locator.path : candidate.path,
          resourceBase: { kind: 'directory', path: candidate.locator ? candidate.locator.directory : candidate.resourceBase.path },
        })
      }
    }
    // 一个没有本地文件的"远程型"skill，用来验证「在本地显示」的拒绝分支
    if (!merged.has('remote-only-skill')) {
      merged.set('remote-only-skill', {
        name: 'remote-only-skill',
        description: '只有 URL，没有本地文件',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'runtime',
        provider: 'remote',
        resourceBase: { kind: 'url', url: 'https://example.com/skill' },
      })
    }
    return { skills: [...merged.values()], complete: true }
  },
  async get(name) {
    const snap = await this.snapshot({})
    const row = snap.skills.find((s) => s.name === name)
    if (!row) return undefined
    // 真实 SkillDefinition：摘要字段 + content 正文
    const provider = providers.find((p) => p.name === row.provider)
    if (provider && row.locator) return provider.get(row)
    return { ...row, content: row.body }
  },
}

const workspaces = [{ id: 'ws-1', title: '测试工作区', path: process.cwd() }]
const services = {
  skills: skillsService,
  workspaceRegistry: { list: () => workspaces },
}

/* ---------------- 假 root / ctx ---------------- */
const mounted = []
const disposers = []
const root = {
  inject(deps, cb) {
    cb(ctx)
  },
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
}
const ctx = {
  get(name) {
    return services[name]
  },
  get skills() {
    return services.skills
  },
  webServer: {
    register(route) {
      mounted.push(route)
      return () => {
        const at = mounted.indexOf(route)
        if (at >= 0) mounted.splice(at, 1)
      }
    },
  },
}

plugin.apply(root)

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const route = mounted.find((r) => (r.kind === 'exact' ? r.path === url.pathname : url.pathname.startsWith(r.path)))
  if (!route) {
    res.writeHead(404)
    res.end('no route')
    return
  }
  Promise.resolve(route.handler(req, res)).catch(() => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'skill-gogo-proj-'))
let customRoot = null

try {
  /* 1. ping */
  const ping = await (await fetch(`${base}/skill-gogo/api/ping`)).json()
  check('ping 返回 ok 与版本', ping.ok === true && typeof ping.version === 'string', `version=${ping.version} skillsService=${ping.skillsService}`)
  check('挂载了 12 条路由', mounted.length === 12, `mounted=${mounted.length}`)

  /* 2. state（用户目录） */
  const state = await (await fetch(`${base}/skill-gogo/api/state`)).json()
  check('state 返回 skill 列表', state.ok === true && Array.isArray(state.skills) && state.skills.length >= 1, `count=${state.skills.length}`)
  check('state 带 counts/sources/workspaces', !!state.counts && Array.isArray(state.sources) && state.workspaces.length === 1)
  const target = state.skills.find((s) => s.dir)
  check('至少一个 skill 可定位目录', !!target, target ? target.name + ' → ' + target.dir : 'none')

  /* 3. 项目级 skill 通过 cwd 生效 */
  await fsp.mkdir(path.join(projectDir, '.dsh', 'skills', 'proj-demo'), { recursive: true })
  await fsp.writeFile(
    path.join(projectDir, '.dsh', 'skills', 'proj-demo', 'SKILL.md'),
    '---\nname: proj-demo\ndescription: 项目级测试 skill\n---\n\n正文 proj-demo\n',
    'utf8',
  )
  const withCwd = await (await fetch(`${base}/skill-gogo/api/state?cwd=${encodeURIComponent(projectDir)}`)).json()
  check('cwd 决定项目级 skill 是否出现', withCwd.skills.some((s) => s.name === 'proj-demo'), `total=${withCwd.skills.length}`)

  /* 4. skill 详情 */
  const detail = await (await fetch(`${base}/skill-gogo/api/skill?name=${encodeURIComponent(target.name)}${withCwd ? '' : ''}`)).json()
  check('skill 详情含 content', detail.ok === true && typeof detail.skill.content === 'string' && detail.skill.content.length > 0, `content=${detail.skill.content.length}B`)
  check('skill 详情列出文件', Array.isArray(detail.files) && detail.files.length >= 1, `files=${detail.files.map((f) => f.path).join(',')}`)

  /* 5. 文件预览 + 越界保护 */
  const file = await (await fetch(`${base}/skill-gogo/api/file?name=${encodeURIComponent(target.name)}&path=SKILL.md`)).json()
  check('文件预览返回文本', file.ok === true && typeof file.file.text === 'string' && file.file.text.length > 0)
  const escapedRes = await fetch(`${base}/skill-gogo/api/file?name=${encodeURIComponent(target.name)}&path=${encodeURIComponent('../../../.credentials.yaml')}`)
  check('目录越界被拒', escapedRes.status === 500 || escapedRes.status === 400 || escapedRes.status === 404, 'status=' + escapedRes.status)

  /* 6. zip 导出 */
  const zipRes = await fetch(`${base}/skill-gogo/api/export?name=${encodeURIComponent(target.name)}`)
  const zipBytes = new Uint8Array(await zipRes.arrayBuffer())
  const disposition = zipRes.headers.get('content-disposition') || ''
  const entries = listZipEntries(zipBytes)
  check('导出返回 zip', zipRes.status === 200 && zipRes.headers.get('content-type') === 'application/zip', `${zipBytes.length}B`)
  check('zip 含 manifest 与 SKILL.md', entries.some((e) => e.name.endsWith('skill-gogo.manifest.json')) && entries.some((e) => e.name.endsWith('SKILL.md')), entries.map((e) => e.name).join(' | '))
  check('Content-Disposition 带文件名', disposition.includes('.zip'), disposition)
  const roundTrip = readZipEntry(zipBytes, `${target.name}/SKILL.md`)
  check('zip 内 SKILL.md 可解出且非空', !!roundTrip && roundTrip.length > 0, roundTrip ? roundTrip.length + 'B' : 'null')

  /* 7. 复制到项目（写操作） */
  const installRes = await fetch(`${base}/skill-gogo/api/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: target.name, cwd: projectDir }),
  })
  const installed = await installRes.json()
  check('POST install 写入项目目录', installed.ok === true && installed.fileCount >= 1, installed.target || installed.error)
  const copied = await fsp.readFile(path.join(projectDir, '.dsh', 'skills', target.name, 'SKILL.md'), 'utf8')
  check('复制后的 SKILL.md 内容一致', copied.length > 0)
  const again = await fetch(`${base}/skill-gogo/api/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: target.name, cwd: projectDir }),
  })
  const againBody = await again.json()
  check('重复复制被拒（不覆盖）', again.ok === false, againBody.error || '')

  /* 8. 信任栅栏 */
  const crossSite = await fetch(`${base}/skill-gogo/api/state`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
  check('cross-site 请求被拒', crossSite.status === 403, 'status=' + crossSite.status)
  // fetch（undici）会忽略自定义 Host，所以用原始 http 请求发一个伪造 Host
  const evilHostStatus = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path: '/skill-gogo/api/state', method: 'GET', headers: { Host: 'evil.example.com' } },
      (res) => {
        res.resume()
        resolve(res.statusCode)
      },
    )
    req.on('error', reject)
    req.end()
  })
  check('非回环 Host 被拒', evilHostStatus === 403, 'status=' + evilHostStatus)
  const crossOrigin = await fetch(`${base}/skill-gogo/api/state`, { headers: { Origin: 'http://evil.example.com', Host: `127.0.0.1:${server.address().port}` } })
  check('跨源 Origin 被拒', crossOrigin.status === 403, 'status=' + crossOrigin.status)

  /* 9. 分类库（文件夹 / 归属 / 补充目录） */
  const initial = await (await fetch(`${base}/skill-gogo/api/library`)).json()
  check('分类库初始为空且带调色板', initial.ok === true && initial.library.folders.length === 0 && initial.colors.length >= 4, `file=${initial.file}`)

  const folderA = { id: 'fA', name: '写作', color: '#0091ff', order: 0 }
  const folderB = { id: 'fB', name: '编程', color: null, order: 1 }
  const savedLib = await (
    await fetch(`${base}/skill-gogo/api/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: [folderA, folderB], assignments: { [target.name]: 'fA' } }),
    })
  ).json()
  check('保存文件夹与归属', savedLib.ok === true && savedLib.library.folders.length === 2 && savedLib.library.assignments[target.name] === 'fA', JSON.stringify(savedLib.library.folders))

  const reread = await (await fetch(`${base}/skill-gogo/api/library`)).json()
  check('分类库已落盘可回读', reread.library.folders[0].name === '写作' && reread.library.folders[0].color === '#0091ff')
  const onDisk = JSON.parse(await fsp.readFile(path.join(TEST_HOME, 'skill-gogo.json'), 'utf8'))
  check('JSON 文件写在 $DSH_HOME 下', onDisk.folders.length === 2 && onDisk.version === 1, path.join(TEST_HOME, 'skill-gogo.json'))

  const badDirs = await fetch(`${base}/skill-gogo/api/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirs: 'nope' }),
  })
  check('非法的 dirs 被拒', badDirs.status === 400, 'status=' + badDirs.status)

  /* 10. 自定义目录：注册成提供方 + 出现在目录里 */
  customRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'skill-gogo-dirs-'))
  await fsp.mkdir(path.join(customRoot, 'my-custom-skill'), { recursive: true })
  await fsp.writeFile(
    path.join(customRoot, 'my-custom-skill', 'SKILL.md'),
    '---\nname: my-custom-skill\ndescription: 来自自定义目录\n---\n\n自定义正文\n',
    'utf8',
  )
  await fsp.mkdir(path.join(customRoot, 'flat-one'), { recursive: true })
  await fsp.writeFile(path.join(customRoot, 'flat-one', 'SKILL.md'), '---\nname: flat-one\ndescription: 目录型的另一个\n---\n\nbody\n', 'utf8')
  await fsp.writeFile(path.join(customRoot, 'not-a-skill.txt'), 'ignore me\n', 'utf8')

  const withDir = await (
    await fetch(`${base}/skill-gogo/api/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirs: [customRoot] }),
    })
  ).json()
  check('保存补充目录', withDir.ok === true && withDir.library.dirs.length === 1, JSON.stringify(withDir.dirStatus))

  const customState = await (await fetch(`${base}/skill-gogo/api/state`)).json()
  const customRow = customState.skills.find((s) => s.name === 'my-custom-skill')
  check('补充目录的 skill 进入目录', !!customRow && customRow.source === 'custom', customRow ? customRow.source + ' | ' + customRow.dir : 'not found')
  check('state 带 dirStatus（存在 + 计数）', customState.dirStatus[0].exists === true && customState.dirStatus[0].skillCount >= 1, JSON.stringify(customState.dirStatus[0]))
  check('提供方已注册到 ctx.skills', providers.length === 1 && providers[0].name === 'skill-gogo', 'providers=' + providers.length)

  const customDetail = await (await fetch(`${base}/skill-gogo/api/skill?name=my-custom-skill`)).json()
  check('补充目录 skill 能读正文', customDetail.ok === true && customDetail.skill.content.includes('自定义正文'), `content=${customDetail.skill.content.length}B`)

  const customZip = await fetch(`${base}/skill-gogo/api/export?name=my-custom-skill`)
  const customZipBytes = new Uint8Array(await customZip.arrayBuffer())
  check('补充目录 skill 能导出 zip', customZip.status === 200 && listZipEntries(customZipBytes).some((e) => e.name.endsWith('SKILL.md')), customZipBytes.length + 'B')

  /* 11. 目录浏览接口 */
  const listing = await (await fetch(`${base}/skill-gogo/api/dirs/list?path=${encodeURIComponent(customRoot)}`)).json()
  const names = (listing.entries || []).map((e) => e.name).sort()
  check('目录浏览列出子目录并标记含 SKILL.md', listing.ok === true && names.join(',') === 'flat-one,my-custom-skill', names.join(','))
  check('目录浏览标出 hasSkill', listing.entries.every((e) => e.hasSkill === true), JSON.stringify(listing.entries.map((e) => [e.name, e.hasSkill])))
  check('目录浏览给出上级路径', typeof listing.parent === 'string' && listing.parent.length > 0, listing.parent)

  const badList = await fetch(`${base}/skill-gogo/api/dirs/list?path=${encodeURIComponent(path.join(customRoot, 'nope'))}`)
  check('浏览不存在的目录 → 500', badList.status === 500, 'status=' + badList.status)

  /* 12. 重扫 */
  const rescan = await fetch(`${base}/skill-gogo/api/rescan`, { method: 'POST' })
  check('POST rescan 成功', (await rescan.json()).ok === true)
  const rescanGet = await fetch(`${base}/skill-gogo/api/rescan`)
  check('rescan 只接受 POST', rescanGet.status === 405, 'status=' + rescanGet.status)

  /* 13. 「在本地显示文件」（dry-run：只算目标，不弹窗口） */
  const reveal = await fetch(`${base}/skill-gogo/api/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: target.name }),
  })
  const revealBody = await reveal.json()
  check(
    'reveal 选中 SKILL.md（select 模式 + dryRun）',
    reveal.ok === true && revealBody.mode === 'select' && revealBody.dryRun === true && /SKILL\.md$/i.test(revealBody.revealed),
    JSON.stringify(revealBody),
  )
  check('reveal 目标是真实存在的本地路径', fs.existsSync(revealBody.revealed), revealBody.revealed)

  const revealGet = await fetch(`${base}/skill-gogo/api/reveal`)
  check('reveal 只接受 POST', revealGet.status === 405, 'status=' + revealGet.status)

  const revealNoName = await fetch(`${base}/skill-gogo/api/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  check('reveal 缺 name → 400', revealNoName.status === 400, 'status=' + revealNoName.status)

  const revealRemote = await fetch(`${base}/skill-gogo/api/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'remote-only-skill' }),
  })
  const revealRemoteBody = await revealRemote.json().catch(() => ({}))
  check('无本地文件的 skill → 404 且给出原因', revealRemote.status === 404 && /没有本地文件/.test(revealRemoteBody.error || ''), revealRemoteBody.error || '')

  /* 14. 重命名 skill（frontmatter + 目录/文件 + 分类归属迁移） */
  // 造一个平铺 skill，并把归属挂到 folderA 上，验证重命名会迁移归属
  await fsp.writeFile(path.join(customRoot, 'flat-file-skill.md'), '---\nname: flat-file-skill\ndescription: 平铺型 skill\n---\n\nbody\n', 'utf8')
  await fetch(`${base}/skill-gogo/api/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: { 'flat-file-skill': 'fA' } }),
  })

  const renameDir = await fetch(`${base}/skill-gogo/api/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'my-custom-skill', newName: 'my-custom-skill-v2' }),
  })
  const renameDirBody = await renameDir.json()
  check(
    '重命名目录型 skill：frontmatter 已改',
    renameDir.ok === true && renameDirBody.name === 'my-custom-skill-v2' && /my-custom-skill-v2[\\/]SKILL\.md$/.test(renameDirBody.file),
    JSON.stringify({ file: renameDirBody.file, pathRenamed: renameDirBody.pathRenamed }),
  )
  const renamedFileText = await fsp.readFile(renameDirBody.file, 'utf8')
  check('重写后的 SKILL.md 里 name 已更新', /^---\n(?:[\s\S]*?\n)?name: my-custom-skill-v2\n/.test(renamedFileText), renamedFileText.split('\n').slice(0, 3).join(' | '))
  check('目录型 skill 的目录也改名了', !!renameDirBody.pathRenamed && fs.existsSync(renameDirBody.pathRenamed) && !fs.existsSync(path.join(customRoot, 'my-custom-skill')), String(renameDirBody.pathRenamed))

  const afterDirRename = await (await fetch(`${base}/skill-gogo/api/state`)).json()
  check(
    '目录里旧名字消失、新名字出现',
    !afterDirRename.skills.some((s) => s.name === 'my-custom-skill') && afterDirRename.skills.some((s) => s.name === 'my-custom-skill-v2' && s.source === 'custom'),
    afterDirRename.skills.filter((s) => s.source === 'custom').map((s) => s.name).join(','),
  )

  const renameFlat = await fetch(`${base}/skill-gogo/api/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'flat-file-skill', newName: 'flat-file-skill-v2' }),
  })
  const renameFlatBody = await renameFlat.json()
  check(
    '重命名平铺型 skill：文件名也改名',
    renameFlat.ok === true && /flat-file-skill-v2\.md$/.test(renameFlatBody.pathRenamed || '') && fs.existsSync(renameFlatBody.pathRenamed),
    String(renameFlatBody.pathRenamed),
  )
  check(
    '分类归属随重命名迁移',
    renameFlatBody.library.assignments['flat-file-skill-v2'] === 'fA' && renameFlatBody.library.assignments['flat-file-skill'] === undefined,
    JSON.stringify(renameFlatBody.library.assignments),
  )

  const renameBad = await fetch(`${base}/skill-gogo/api/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'flat-file-skill-v2', newName: 'Bad Name' }),
  })
  check('非法新名称 → 400', renameBad.status === 400, 'status=' + renameBad.status)

  const renameClash = await fetch(`${base}/skill-gogo/api/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'flat-file-skill-v2', newName: 'flat-one' }),
  })
  check('与现有 skill 同名 → 409', renameClash.status === 409, 'status=' + renameClash.status)

  const renameSame = await fetch(`${base}/skill-gogo/api/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'flat-file-skill-v2', newName: 'flat-file-skill-v2' }),
  })
  check('新名称与原名相同 → 400', renameSame.status === 400, 'status=' + renameSame.status)

  const renameUnknown = await fetch(`${base}/skill-gogo/api/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'no-such-skill', newName: 'whatever-name' }),
  })
  check('未知 skill → 500', renameUnknown.status === 500, 'status=' + renameUnknown.status)

  const renameGet = await fetch(`${base}/skill-gogo/api/rename`)
  check('rename 只接受 POST', renameGet.status === 405, 'status=' + renameGet.status)

  /* 15. 释放 */
  for (const dispose of disposers) dispose()
  check('释放后路由全部注销', mounted.length === 0, 'mounted=' + mounted.length)
} finally {
  await new Promise((resolve) => server.close(resolve))
  await fsp.rm(projectDir, { recursive: true, force: true })
  await fsp.rm(customRoot, { recursive: true, force: true }).catch(() => {})
  await fsp.rm(TEST_HOME, { recursive: true, force: true }).catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL ${results.length} CHECKS PASSED`))
process.exit(failed.length ? 1 : 0)
