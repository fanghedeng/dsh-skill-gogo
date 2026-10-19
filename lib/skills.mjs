/**
 * Skill GoGo —— 宿主侧的数据层：把 ctx.skills 的目录读成 UI 需要的形状，
 * 并支持把一个 skill 目录打包成可下载的 zip。
 *
 * 这一层不依赖 Cordis，方便用普通 node 做单元测试。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { createZip } from './zip.mjs'

export const DEFAULT_LIMITS = {
  maxFiles: 400,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxDepth: 6,
  maxPreviewChars: 200000,
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.venv'])

/** SKILL.md 常见位置优先排序，让列表里最重要的文件排前面。 */
function fileRank(rel) {
  const base = rel.split('/').pop().toLowerCase()
  if (base === 'skill.md') return 0
  if (base === 'readme.md') return 1
  if (rel.indexOf('/') < 0) return 2
  if (/\.(md|txt|json|ya?ml)$/i.test(rel)) return 3
  return 4
}

/** 从 SkillSummary 推出 skill 所在目录；推不出来返回 null。 */
export function skillDirectory(summary) {
  if (!summary) return null
  const base = summary.resourceBase
  if (base && typeof base === 'object') {
    if (base.kind === 'directory' && typeof base.path === 'string' && base.path) return base.path
    if (base.kind === 'url') return null
    if (base.kind === 'opaque') return null
  }
  if (typeof summary.path === 'string' && summary.path) {
    const p = summary.path
    // path 一般指向 SKILL.md 本身
    return /\.md$/i.test(p) ? path.dirname(p) : p
  }
  return null
}

/** 递归列出 skill 目录内可导出的文件。 */
export async function listSkillFiles(dir, limits = {}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits }
  const out = []
  let totalBytes = 0
  let truncated = false

  async function walk(current, depth) {
    if (depth > cfg.maxDepth || out.length >= cfg.maxFiles || truncated) return
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= cfg.maxFiles) {
        truncated = true
        return
      }
      if (entry.name.startsWith('.') && entry.name !== '.skillignore') continue
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(abs, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      let stat
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      if (stat.size > cfg.maxFileBytes) {
        truncated = true
        continue
      }
      if (totalBytes + stat.size > cfg.maxTotalBytes) {
        truncated = true
        return
      }
      totalBytes += stat.size
      out.push({
        rel: path.relative(dir, abs).split(path.sep).join('/'),
        size: stat.size,
        mtime: stat.mtime,
      })
    }
  }

  await walk(dir, 0)
  out.sort((a, b) => fileRank(a.rel) - fileRank(b.rel) || a.rel.localeCompare(b.rel))
  return { files: out, bytes: totalBytes, truncated }
}

function isProbablyText(bytes) {
  const sample = bytes.subarray(0, 4096)
  for (let i = 0; i < sample.length; i += 1) if (sample[i] === 0) return false
  return true
}

/** 读取单个文件（相对 skill 目录），带越界保护。 */
export async function readSkillFile(dir, rel, limits = {}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits }
  const abs = path.resolve(dir, rel)
  const root = path.resolve(dir)
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('path escapes skill directory')
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new Error('not a file')
  if (stat.size > cfg.maxFileBytes) throw new Error('file too large to preview')
  const bytes = await fs.readFile(abs)
  const text = isProbablyText(bytes) ? new TextDecoder().decode(bytes) : null
  return {
    path: rel.split(path.sep).join('/'),
    size: stat.size,
    binary: text === null,
    text: text === null ? null : text.slice(0, cfg.maxPreviewChars),
    truncated: text !== null && text.length > cfg.maxPreviewChars,
  }
}

/** 把 skill 目录打包成 zip（顶层目录名为 skill 名，便于解压后不散落）。 */
export async function buildSkillZip(summary, options = {}) {
  const dir = skillDirectory(summary)
  if (!dir) throw new Error('skill has no readable directory')
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  const { files, truncated } = await listSkillFiles(dir, limits)
  if (!files.length) throw new Error('skill directory has no readable files')

  const prefix = String(options.prefix || summary.name || 'skill')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.+$/, '')
  const entries = []
  for (const file of files) {
    try {
      entries.push({
        path: `${prefix}/${file.rel}`,
        data: await fs.readFile(path.join(dir, file.rel)),
        mtime: file.mtime,
      })
    } catch {
      /* 读不到就跳过，不让单个文件毁掉整次导出 */
    }
  }
  if (!entries.length) throw new Error('skill directory has no readable files')

  const manifest = {
    name: summary.name,
    description: summary.description,
    source: summary.source,
    provider: summary.provider,
    invocation: summary.invocation,
    whenToUse: summary.whenToUse,
    exportedAt: new Date().toISOString(),
    exportedBy: 'skill-gogo',
    files: entries.map((e) => e.path),
    truncated,
  }
  entries.unshift({
    path: `${prefix}/skill-gogo.manifest.json`,
    data: JSON.stringify(manifest, null, 2),
    mtime: new Date(),
  })

  return { bytes: createZip(entries), fileCount: entries.length, dir, truncated }
}

/** 把 ctx.skills.list() 的结果整理成 UI 行（保留原始字段，额外派生 dir / 可导出标记）。 */
export function toCatalogRows(skills) {
  const rows = []
  for (const skill of skills || []) {
    if (!skill || typeof skill.name !== 'string') continue
    const dir = skillDirectory(skill)
    rows.push({
      name: skill.name,
      description: skill.description || '',
      whenToUse: skill.whenToUse || '',
      source: typeof skill.source === 'string' ? skill.source : 'unknown',
      provider: typeof skill.provider === 'string' ? skill.provider : 'unknown',
      modelInvocable: skill.invocation ? skill.invocation.modelInvocable !== false : true,
      userInvocable: skill.invocation ? skill.invocation.userInvocable !== false : true,
      path: typeof skill.path === 'string' ? skill.path : null,
      resource: skill.resourceBase ? skill.resourceBase.kind : null,
      dir,
      invocable: `/skill ${skill.name}`,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

export const SOURCE_LABELS = {
  'user-dsh': '用户目录',
  'user-agents': '用户 Agents',
  'project-dsh': '项目 .dsh',
  'project-agents': '项目 Agents',
  runtime: '运行时注册',
  custom: '自定义目录',
  bundled: '内置',
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || '未知'
}
