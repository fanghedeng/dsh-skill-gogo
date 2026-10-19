// 探针：frontmatter name 改写（保留其余字节）
import { rewriteFrontmatterName as rewrite } from '../lib/index.js'

const cases = [
  ['lf', '---\nname: old\ndescription: d\n---\n\nbody\n', 'new-one'],
  ['crlf', '---\r\nname: old\r\ndescription: d\r\n---\r\n\r\nbody', 'n2'],
  ['no-name', '---\ndescription: d\n---\n\nbody', 'n3'],
  ['quoted', '---\nname: "old"\ndescription: d\nwhenToUse: x\n---\nbody', 'n4'],
  ['bad', 'no frontmatter here', 'n5'],
]
for (const [label, text, name] of cases) {
  const out = rewrite(text, name)
  console.log(label, '=>', JSON.stringify(out))
  if (label !== 'bad' && out) {
    const expected = text.replace(/^---\r?\n(?:.*\r?\n)*?name:.*\r?\n/, (m) => m.replace(/name:.*/, 'name: ' + name))
    void expected
  }
}
