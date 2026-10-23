import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { regularNpmFiles } from '../scripts/exact-pack.mjs'
function member(name, content = '{}', type = '0') {
  const header = Buffer.alloc(512), data = Buffer.from(content)
  header.write(name); header.write('0000644\0',100); header.write(data.length.toString(8).padStart(11,'0')+'\0',124)
  header.fill(32,148,156); header.write(type,156); header.write('ustar\0',257)
  const sum=header.reduce((a,b)=>a+b,0); header.write(sum.toString(8).padStart(6,'0')+'\0 ',148)
  return Buffer.concat([header,data,Buffer.alloc((512-data.length%512)%512)])
}
const tar = chunks => gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]))
test('regular npm file bytes are preserved', () => {
  const files=regularNpmFiles(tar([member('package/package.json','{"name":"synthetic"}'),member('package/lib/index.js','safe')]))
  assert.equal(files.size,2);assert.equal(files.get('lib/index.js').toString(),'safe')
})
for (const [name, chunks] of [
  ['path traversal',[member('package/../outside'),member('package/package.json')]],
  ['symlink',[member('package/package.json','{}','2')]],
  ['duplicate',[member('package/package.json'),member('package/package.json')]],
  ['missing manifest',[member('package/lib/index.js')]],
  ['hidden trailing archive',[member('package/package.json'),Buffer.alloc(512),member('package/hidden')]],
]) test(`${name} tar rejected`,()=>assert.throws(()=>regularNpmFiles(tar(chunks))))
