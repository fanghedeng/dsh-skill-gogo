/**
 * Skill GoGo —— 插件自己的持久化数据（"分类库"）。
 *
 * 存一个 JSON 文件：`$DSH_HOME/skill-gogo.json`
 *   {
 *     version: 1,
 *     folders:     [{ id, name, color, order }],   // 分类（文件夹）
 *     assignments: { "<skill 名>": "<folder id>" },// skill → 分类
 *     dirs:        ["D:\\skills", ...],            // 用户补充的 skill 目录
 *     updatedAt
 *   }
 *
 * 所有写入都经过 normalize（长度/数量/取值白名单）+ 原子写（临时文件 + rename），
 * 读到的坏数据一律回退到空库，绝不让插件的存储问题影响 DSH 本身。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export const LIBRARY_VERSION = 1
export const MAX_FOLDERS = 100
export const MAX_ASSIGNMENTS = 2000
export const MAX_DIRS = 20
export const MAX_NAME_CHARS = 40
export const MAX_PATH_CHARS = 512

/** 供 UI 选色的白名单（都取自主题语义色的近似值，明暗主题下都可读）。 */
export const FOLDER_COLORS = [
  '#e5484d',
  '#e8890c',
  '#e5c00c',
  '#30a46c',
  '#0d9488',
  '#0091ff',
  '#6e56cf',
  '#d6409f',
]

export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

export function libraryPath() {
  return path.join(dshHome(), 'skill-gogo.json')
}

export function emptyLibrary() {
  return { version: LIBRARY_VERSION, folders: [], assignments: {}, dirs: [], updatedAt: null }
}

function clampText(value, maxChars) {
  const text = String(value == null ? '' : value).trim()
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

function newFolderId() {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** 校验/清洗一份库数据；抛错即表示数据不可用。 */
export function normalizeLibrary(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const library = emptyLibrary()

  const rawFolders = Array.isArray(source.folders) ? source.folders : []
  const seenIds = new Set()
  let order = 0
  for (const raw of rawFolders.slice(0, MAX_FOLDERS)) {
    if (!raw || typeof raw !== 'object') continue
    const name = clampText(raw.name, MAX_NAME_CHARS)
    if (!name) continue
    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : newFolderId()
    while (seenIds.has(id)) id = newFolderId()
    seenIds.add(id)
    const color = typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color.toLowerCase() : null
    library.folders.push({ id, name, color, order: order++ })
  }

  const rawAssignments = source.assignments && typeof source.assignments === 'object' && !Array.isArray(source.assignments) ? source.assignments : {}
  let count = 0
  for (const [skill, folderId] of Object.entries(rawAssignments)) {
    if (count >= MAX_ASSIGNMENTS) break
    if (typeof skill !== 'string' || !skill.trim()) continue
    if (typeof folderId !== 'string' || !seenIds.has(folderId)) continue
    library.assignments[clampText(skill, 120)] = folderId
    count += 1
  }

  const rawDirs = Array.isArray(source.dirs) ? source.dirs : []
  const seenDirs = new Set()
  for (const raw of rawDirs.slice(0, MAX_DIRS)) {
    if (typeof raw !== 'string') continue
    const dir = clampText(raw, MAX_PATH_CHARS)
    if (!dir || !path.isAbsolute(dir)) continue
    const key = dir.toLowerCase()
    if (seenDirs.has(key)) continue
    seenDirs.add(key)
    library.dirs.push(dir)
  }

  library.updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : null
  return library
}

/** 读库；文件不存在/损坏都返回空库（不抛错）。 */
export async function readLibrary(file = libraryPath()) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return normalizeLibrary(JSON.parse(raw))
  } catch {
    return emptyLibrary()
  }
}

/** 把局部改动合并进当前库并原子落盘，返回落盘后的库。 */
export async function patchLibrary(patch, file = libraryPath()) {
  const current = await readLibrary(file)
  const next = normalizeLibrary({
    version: LIBRARY_VERSION,
    folders: patch && patch.folders !== undefined ? patch.folders : current.folders,
    assignments: patch && patch.assignments !== undefined ? patch.assignments : current.assignments,
    dirs: patch && patch.dirs !== undefined ? patch.dirs : current.dirs,
    updatedAt: new Date().toISOString(),
  })
  const text = JSON.stringify(next, null, 2)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file)
  return next
}
