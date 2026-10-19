/**
 * 无依赖的 ZIP 写入器（仅 store / 不压缩）。
 *
 * 为什么自己写：DSH 插件包要能在离线环境安装，不能引入 archiver/jszip 这类依赖；
 * 而 skill 导出只需要把若干文件打包成一个可下载的 .zip —— store 模式足够，
 * 且实现完全确定、可单元测试。
 *
 * 参考 PKWARE APPNOTE.TXT 4.3.6 / 4.3.7 / 4.3.12 / 4.3.16。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS 时间/日期（本地时间，ZIP 不支持时区）。 */
export function dosDateTime(date = new Date()) {
  const year = date.getFullYear()
  const dosYear = year < 1980 ? 0 : year - 1980
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f)
  const day = (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time: time & 0xffff, date: day & 0xffff }
}

const utf8 = (s) => new TextEncoder().encode(s)

/**
 * @param {Array<{ path: string, data: Uint8Array | string, mtime?: Date }>} entries
 * @returns {Uint8Array} 完整 zip 字节
 */
export function createZip(entries, options = {}) {
  const chunks = []
  const central = []
  let offset = 0
  const push = (bytes) => {
    chunks.push(bytes)
    offset += bytes.length
  }
  const writeU16 = (view, at, value) => view.setUint16(at, value & 0xffff, true)
  const writeU32 = (view, at, value) => view.setUint32(at, value >>> 0, true)

  for (const entry of entries) {
    const name = String(entry.path).replace(/\\/g, '/').replace(/^\/+/, '')
    if (!name) continue
    const raw = typeof entry.data === 'string' ? utf8(entry.data) : entry.data
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    const nameBytes = utf8(name)
    const crc = crc32(data)
    const { time, date } = dosDateTime(entry.mtime instanceof Date ? entry.mtime : new Date(0))
    const flags = 0x0800 // UTF-8 文件名
    const localOffset = offset

    const localHeader = new Uint8Array(30 + nameBytes.length)
    const lh = new DataView(localHeader.buffer)
    writeU32(lh, 0, 0x04034b50)
    writeU16(lh, 4, 20)
    writeU16(lh, 6, flags)
    writeU16(lh, 8, 0)
    writeU16(lh, 10, time)
    writeU16(lh, 12, date)
    writeU32(lh, 14, crc)
    writeU32(lh, 18, data.length)
    writeU32(lh, 22, data.length)
    writeU16(lh, 26, nameBytes.length)
    writeU16(lh, 28, 0)
    localHeader.set(nameBytes, 30)
    push(localHeader)
    push(data)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const ch = new DataView(centralHeader.buffer)
    writeU32(ch, 0, 0x02014b50)
    writeU16(ch, 4, 20) // version made by
    writeU16(ch, 6, 20) // version needed
    writeU16(ch, 8, flags)
    writeU16(ch, 10, 0)
    writeU16(ch, 12, time)
    writeU16(ch, 14, date)
    writeU32(ch, 16, crc)
    writeU32(ch, 20, data.length)
    writeU32(ch, 24, data.length)
    writeU16(ch, 28, nameBytes.length)
    writeU16(ch, 30, 0) // extra
    writeU16(ch, 32, 0) // comment
    writeU16(ch, 34, 0) // disk
    writeU16(ch, 36, 0) // internal attrs
    writeU32(ch, 38, 0) // external attrs
    writeU32(ch, 42, localOffset)
    centralHeader.set(nameBytes, 46)
    central.push(centralHeader)
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const centralOffset = offset
  for (const c of central) push(c)

  const eocd = new Uint8Array(22)
  const e = new DataView(eocd.buffer)
  writeU32(e, 0, 0x06054b50)
  writeU16(e, 4, 0)
  writeU16(e, 6, 0)
  writeU16(e, 8, central.length)
  writeU16(e, 10, central.length)
  writeU32(e, 12, centralSize)
  writeU32(e, 16, centralOffset)
  writeU16(e, 20, 0)
  push(eocd)

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  void options
  return out
}

/** 读取 zip 中央目录（仅用于测试/自检，不依赖外部库）。 */
export function listZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 从尾部找 EOCD
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 0xffff; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('EOCD not found')
  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central header')
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 24, true)
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen))
    entries.push({ name, size, crc, localOffset })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 解出 store 模式的单个条目内容（仅用于测试）。 */
export function readZipEntry(bytes, name) {
  const entry = listZipEntries(bytes).find((e) => e.name === name)
  if (!entry) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const nameLen = view.getUint16(entry.localOffset + 26, true)
  const extraLen = view.getUint16(entry.localOffset + 28, true)
  const start = entry.localOffset + 30 + nameLen + extraLen
  return bytes.subarray(start, start + entry.size)
}
