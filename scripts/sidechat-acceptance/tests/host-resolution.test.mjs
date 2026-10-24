import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveExactHost } from '../scripts/sidechat-host-contract.mjs'
async function synthetic(layout, work) {
  const root = await mkdtemp(join(tmpdir(), 'dsh354-resolution-contract-'))
  try {
    const cli=layout==='source'?join(root,'apps/cli'):join(root,'node_modules/@deepseek-ai/dsh')
    await mkdir(join(cli,'lib'),{recursive:true});await writeFile(join(cli,'lib/bin.js'),'// Synthetic resolution metadata only; never executed.')
    await writeFile(join(cli,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.1-rc.3'}))
    for(const name of ['dsh-agent','dsh-subagent','dsh-llm','dsh-llm-replay']) {
      const path=join(root,'node_modules/@deepseek-ai',name);await mkdir(join(path,'lib'),{recursive:true})
      await writeFile(join(path,'package.json'),JSON.stringify({name:'@deepseek-ai/'+name,version:'0.2.1-rc.3',main:'lib/index.js'}))
      await writeFile(join(path,'lib/index.js'),'// Synthetic metadata only; never imported.')
    }
    await work({hostLayout:layout,dshRoot:root,dshBin:join(cli,'lib/bin.js')},cli)
  } finally {await rm(root,{recursive:true,force:true})}
}
for(const layout of ['source','registry'])test(`explicit ${layout} exact rc.3 built resolution`,()=>synthetic(layout,async options=>{
  const result=await resolveExactHost(options);assert.equal(result.hostLayout,layout);assert.equal(result.hostVersion,'0.2.1-rc.3');assert.equal(Object.keys(result.modules).length,4)
}))
test('minimum or unknown host is rejected rather than skipped',()=>synthetic('source',async(options,cli)=>{
  await writeFile(join(cli,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.0-rc.1'}));await assert.rejects(resolveExactHost(options),/Only exact rc.3/u)
}))
for (const version of ['0.2.1-rc.1', '0.2.1-rc.2']) test(`mixed dependency tuple ${version} is rejected`,()=>synthetic('registry',async options=>{
  const file=join(options.dshRoot,'node_modules/@deepseek-ai/dsh-agent/package.json')
  await writeFile(file,JSON.stringify({name:'@deepseek-ai/dsh-agent',version,main:'lib/index.js'}));await assert.rejects(resolveExactHost(options),/Mixed host graph/u)
}))
test('wrong launcher is rejected before execution',()=>synthetic('source',async options=>{
  const bin=join(options.dshRoot,'other.js');await writeFile(bin,'// Never executed');await assert.rejects(resolveExactHost({...options,dshBin:bin}),/official built bin/u)
}))
test('symlink escape from owned host graph fails closed',()=>synthetic('source',async options=>{
  const outside=await mkdtemp(join(tmpdir(),'dsh354-outside-contract-'))
  try {
    const path=join(options.dshRoot,'node_modules/@deepseek-ai/dsh-agent');await rm(path,{recursive:true});await mkdir(join(outside,'lib'))
    await writeFile(join(outside,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh-agent',version:'0.2.1-rc.3',main:'lib/index.js'}));await writeFile(join(outside,'lib/index.js'),'// Never executed')
    await symlink(outside,path);await assert.rejects(resolveExactHost(options),/escaped/u)
  }finally{await rm(outside,{recursive:true,force:true})}
}))

for (const layout of ['source', 'registry']) test(`mixed llm constructor dependency is rejected in ${layout} layout`, () => synthetic(layout, async options => {
  const file = join(options.dshRoot, 'node_modules/@deepseek-ai/dsh-llm/package.json')
  await writeFile(file, JSON.stringify({ name: '@deepseek-ai/dsh-llm', version: '0.2.1-rc.1', main: 'lib/index.js' }))
  await assert.rejects(resolveExactHost(options), /Mixed host graph/u)
}))
