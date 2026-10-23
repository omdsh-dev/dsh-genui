/** Dependency-free bounded reader for regular-file npm tarballs. Never extracts
 * links, arbitrary paths, or executes a package. Unknown archive forms fail. */
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { readFile, realpath } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { isChildPath } from './sidechat-host-contract.mjs'
export function regularNpmFiles(compressed) {
  const archive = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 })
  const files = new Map()
  let offset = 0
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '')
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512); offset += 512
    if (header.every(byte => byte === 0)) {
      assert.ok(archive.subarray(offset).every(byte => byte === 0), 'Nonzero content after tar terminator')
      break
    }
    const checksum = Number.parseInt(field(header, 148, 8).trim(), 8)
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]
    assert.equal(sum, checksum, 'Tar header checksum mismatch')
    const prefix = field(header, 345, 155), name = (prefix ? prefix + '/' : '') + field(header, 0, 100)
    assert.ok(name.startsWith('package/') && posix.normalize(name) === name && !name.includes('\\'), 'Unsafe/non-package tar path')
    const relative = name.slice(8)
    assert.ok(relative && !relative.startsWith('/') && !relative.split('/').includes('..'))
    const type = field(header, 156, 1)
    assert.ok(type === '' || type === '0', 'Only regular-file npm tarballs are accepted; links/PAX/unknown entries refused')
    const sizeText = field(header, 124, 12).trim()
    assert.match(sizeText, /^[0-7]+$/u)
    const size = Number.parseInt(sizeText, 8)
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + size <= archive.length, 'Truncated tar member')
    assert.ok(!files.has(relative), 'Duplicate tar path')
    files.set(relative, archive.subarray(offset, offset + size))
    offset += Math.ceil(size / 512) * 512
    assert.ok(files.size <= 2000, 'Oversized package file count')
  }
  assert.ok(files.has('package.json'), 'Package manifest required')
  return files
}
export async function inspectPack(file, expectedName) {
  const files = regularNpmFiles(await readFile(file))
  const pkg = JSON.parse(files.get('package.json').toString('utf8'))
  assert.equal(pkg.name, expectedName); assert.equal(typeof pkg.version, 'string')
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(pkg.scripts?.[name], undefined, 'Candidate lifecycle execution is not allowed')
  return { files, name: pkg.name, version: pkg.version }
}
export async function verifyInstalledPack(pack, profileDir, ownedRoot) {
  const root = await realpath(join(profileDir, 'node_modules', pack.name))
  assert.ok(isChildPath(await realpath(ownedRoot), root), 'Installed candidate escaped the disposable profile')
  for (const [name, bytes] of pack.files) {
    const installed = await realpath(join(root, name))
    assert.ok(isChildPath(root, installed), 'Installed member escaped candidate root')
    assert.ok((await readFile(installed)).equals(bytes), `Installed candidate differs from reviewed pack: ${name}`)
  }
  return { name: pack.name, version: pack.version, matchedFiles: pack.files.size }
}
