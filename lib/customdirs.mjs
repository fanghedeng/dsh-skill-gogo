/**
 * 自定义 skill 目录：扫描用户选择的一个或多个目录，并注册成 `ctx.skills` 的提供方。
 *
 * 发现规则与官方 filesystem 提供方保持一致（只认一层）：
 *   <root>/<name>/SKILL.md   目录型
 *   <root>/<name>.md         平铺文件型
 * 因此用户补充的目录里的 skill 不仅出现在面板里，模型与 `/名字` 调用也能用上。
 */

import fs from 'node:fs/promises'
import path from 'node:path'

/** 与官方一致的 rank：项目根（100/200）之后、用户根（300+）之前。 */
export const CUSTOM_DIR_RANK = 250
export const PROVIDER_NAME = 'skill-gogo'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TRUTHY = new Set(['true', 'yes', 'on', '1'])

/**
 * 解析 SKILL.md 的 YAML frontmatter（只处理本插件需要的标量字段）。
 * @returns {{name: string, description: string, whenToUse?: string, invocation: {modelInvocable: boolean, userInvocable: boolean}, metadata?: Record<string, unknown>} | null}
 */
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return null
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return null
  const end = normalized.indexOf('\n---', 3)
  if (end < 0) return null

  const fields = {}
  for (const line of normalized.slice(4, end + 1).split('\n')) {
    if (!line || /^\s/.test(line) || line.startsWith('#')) continue // 忽略缩进块（metadata: 等）与注释
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    fields[match[1]] = value
  }

  const name = typeof fields.name === 'string' ? fields.name.trim() : ''
  const description = typeof fields.description === 'string' ? fields.description.trim() : ''
  if (!name || !KEBAB.test(name) || !description) return null

  const whenToUse = typeof fields.whenToUse === 'string' && fields.whenToUse.trim() ? fields.whenToUse.trim() : undefined
  const disableModel = TRUTHY.has(String(fields['disable-model-invocation'] || '').toLowerCase())
  const userInvocableRaw = String(fields['user-invocable'] || '').toLowerCase()
  const userInvocable = userInvocableRaw ? TRUTHY.has(userInvocableRaw) : true

  return {
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    invocation: { modelInvocable: !disableModel, userInvocable },
  }
}

async function isFile(target) {
  try {
    return (await fs.stat(target)).isFile()
  } catch {
    return false
  }
}

/** 列出 root 下的 skill 候选（一层）。 */
export async function scanDirRoot(root) {
  const found = []
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry || entry.name.startsWith('.')) continue
    const abs = path.join(root, entry.name)
    const skillFile = entry.isDirectory() ? path.join(abs, 'SKILL.md') : entry.isFile() && /\.md$/i.test(entry.name) ? abs : null
    if (!skillFile || !(await isFile(skillFile))) continue
    let text
    try {
      text = await fs.readFile(skillFile, 'utf8')
    } catch {
      continue
    }
    const meta = parseFrontmatter(text)
    if (!meta) continue
    found.push({
      name: meta.name,
      description: meta.description,
      ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
      invocation: meta.invocation,
      source: 'custom',
      provider: PROVIDER_NAME,
      path: skillFile,
      resourceBase: { kind: 'directory', path: path.dirname(skillFile) },
      rank: CUSTOM_DIR_RANK,
      locator: { path: skillFile, directory: path.dirname(skillFile), root },
    })
  }
  return found
}

/** 目录状态（给 UI 显示"这个目录还在不在、有几个 skill"）。 */
export async function describeDirs(dirs) {
  const out = []
  for (const dir of dirs) {
    let exists = false
    let skillCount = 0
    try {
      exists = (await fs.stat(dir)).isDirectory()
    } catch {
      exists = false
    }
    if (exists) {
      try {
        skillCount = (await scanDirRoot(dir)).length
      } catch {
        skillCount = 0
      }
    }
    out.push({ path: dir, exists, skillCount })
  }
  return out
}

/**
 * 造一个 `ctx.skills.registerProvider` 用的工厂。
 * @param {{ getDirs: () => string[] }} options
 */
export function createCustomDirsProvider({ getDirs }) {
  return (control) => ({
    name: PROVIDER_NAME,
    async list() {
      const dirs = getDirs() || []
      const byName = new Map()
      for (const dir of dirs) {
        const candidates = await scanDirRoot(dir)
        for (const candidate of candidates) if (!byName.has(candidate.name)) byName.set(candidate.name, candidate)
      }
      if (control && typeof control.invalidate !== 'function') {
        /* control 只用于失效，不做其它事 */
      }
      return { candidates: [...byName.values()], complete: true }
    },
    async get(candidate) {
      const locator = candidate && candidate.locator
      if (!locator || typeof locator.path !== 'string') return undefined
      let content
      try {
        content = await fs.readFile(locator.path, 'utf8')
      } catch {
        return undefined
      }
      const meta = parseFrontmatter(content)
      if (!meta) return undefined
      const body = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
      const fenceEnd = body.startsWith('---\n') ? body.indexOf('\n---', 3) : -1
      const stripped = fenceEnd < 0 ? body : body.slice(fenceEnd + 4).replace(/^\n+/, '')
      return {
        name: meta.name,
        description: meta.description,
        ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
        invocation: meta.invocation,
        source: 'custom',
        provider: PROVIDER_NAME,
        path: locator.path,
        resourceBase: { kind: 'directory', path: locator.directory },
        content: stripped,
      }
    },
  })
}
