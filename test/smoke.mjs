// 数据层冒烟测试：不依赖 DSH，直接用真实 skill 目录验证 list/read/zip
import path from 'node:path'
import os from 'node:os'
import { skillDirectory, listSkillFiles, readSkillFile, buildSkillZip, toCatalogRows } from '../lib/skills.mjs'
import { listZipEntries, readZipEntry } from '../lib/zip.mjs'

const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const dir = path.join(home, 'skills', 'life-decision-guide')

const summary = {
  name: 'life-decision-guide',
  description: '用可复现的框架梳理人生决策',
  whenToUse: '当用户需要权衡重大选择时',
  source: 'user-dsh',
  provider: 'filesystem',
  invocation: { modelInvocable: true, userInvocable: true },
  path: path.join(dir, 'SKILL.md'),
  resourceBase: { kind: 'directory', path: dir },
}

console.log('skillDirectory =', skillDirectory(summary))

const listing = await listSkillFiles(dir)
console.log('files =', JSON.stringify(listing.files.map((f) => `${f.rel} (${f.size}B)`), null, 0))
console.log('bytes =', listing.bytes, 'truncated =', listing.truncated)

const first = await readSkillFile(dir, listing.files[0].rel)
console.log('preview head =', JSON.stringify(first.text.slice(0, 120)))
console.log('binary =', first.binary, 'size =', first.size)

const zip = await buildSkillZip(summary)
console.log('zip bytes =', zip.bytes.length, 'entries =', zip.fileCount)
const entries = listZipEntries(zip.bytes)
for (const e of entries) console.log('  zip:', e.name, e.size, 'crc=' + e.crc.toString(16))
const skillMd = readZipEntry(zip.bytes, 'life-decision-guide/SKILL.md')
console.log('roundtrip SKILL.md bytes =', skillMd && skillMd.length)

const rows = toCatalogRows([summary])
console.log('rows =', JSON.stringify(rows, null, 2))

// 路径越界必须被拒
let escaped = false
try {
  await readSkillFile(dir, '../../.credentials.yaml')
} catch {
  escaped = true
}
console.log('escape blocked =', escaped)

const ok = entries.length === listing.files.length + 1 && skillMd && skillMd.length > 0 && escaped
console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED')
process.exit(ok ? 0 : 1)
