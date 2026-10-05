const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

async function runScenario(options = {}) {
  const calls = [], exits = []
  const fail = label => { calls.push(label); if (options.fail === label) throw Error('injected '+label) }
  const H = {
    created: { users: [1], posts: [], games: [], announcements: [], files: [], dirs: [] },
    cleanup: async () => fail('cleanup'), summary: () => true,
    pool: { execute: async () => { fail('count'); return [[{ c: options.residue ? 1 : 0 }]] }, end: async () => fail('pool.end') },
  }
  const setup = {
    prepareTestDatabase: async ({ onCreated }) => {
      fail('prepare')
      onCreated('isolated_test')
      fail('initialize')
    },
    dropTestDatabase: async name => { assert.equal(name,'isolated_test'); fail('drop') },
  }
  const module = { exports: {} }
  const fakeRequire = name => {
    if (name === 'path') return path
    if (name === 'fs') return { existsSync: () => false }
    if (name === 'dotenv') return { config() {} }
    if (name === './setupTestDatabase') return setup
    if (name === './helpers') return H
    if (name === '../server.js') return { start: async () => fail('start'), stop: async () => fail('stop') }
    if (/\.suite\.js$/.test(name)) return async () => {}
    throw Error('Unexpected import '+name)
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'run-all.js'),'utf8'), {
    require: fakeRequire, module, __dirname,
    process: { env: {}, chdir() {}, exit: code => exits.push(code) },
    console: { log() {}, error() {} },
  })
  await module.exports.main()
  return { calls, exits }
}
test('successful run exits zero and always closes its resources', async () => {
  const { calls, exits } = await runScenario()
  assert.deepEqual(exits,[0]); assert.deepEqual(calls.slice(-3),['stop','pool.end','drop'])
})
test('residue fails the run even when all suites pass', async () => {
  assert.deepEqual((await runScenario({ residue:true })).exits,[1])
})
for (const fail of ['cleanup','count','stop','pool.end']) {
  test('failure in '+fail+' still attempts database cleanup', async () => {
    const result = await runScenario({ fail })
    assert.deepEqual(result.exits,[1]); assert.ok(result.calls.includes('drop'))
    if (['cleanup','count'].includes(fail)) assert.ok(result.calls.includes('stop'))
    assert.ok(result.calls.includes('pool.end'))
  })
}
test('partial initialization is cleaned, refused existing database is not dropped', async () => {
  const partial = await runScenario({ fail:'initialize' })
  assert.deepEqual(partial.exits,[1]); assert.ok(partial.calls.includes('drop'))
  const occupied = await runScenario({ fail:'prepare' })
  assert.deepEqual(occupied.exits,[1]); assert.ok(!occupied.calls.includes('drop'))
})

test('database setup refuses an occupied name without dropping it', async () => {
  const queries = [], callbacks = [], module = { exports:{} }
  let closed = false
  const db = { query: async sql => {queries.push(sql);throw Object.assign(Error('occupied'),{code:'ER_DB_CREATE_EXISTS'})}, end: async()=>{closed=true} }
  const fakeRequire = name => {
    if(name==='fs')return fs
    if(name==='path')return path
    if(name==='mysql2/promise')return {createConnection:async()=>db}
    if(name==='bcrypt')return {}
    throw Error('Unexpected import '+name)
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'setupTestDatabase.js'),'utf8'),{
    require:fakeRequire,module,__dirname,process:{env:{TEST_DB_NAME:'occupied_test'}},
  })
  await assert.rejects(()=>module.exports.prepareTestDatabase({onCreated:n=>callbacks.push(n)}),/occupied/)
  assert.deepEqual(queries,['CREATE DATABASE `occupied_test` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'])
  assert.deepEqual(callbacks,[]);assert.equal(closed,true)
})
