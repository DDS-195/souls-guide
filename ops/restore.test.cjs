const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { gzipSync } = require('node:zlib')
const { createHash } = require('node:crypto')
const { spawnSync, execFileSync } = require('node:child_process')

// Runs the real restore script against fake Docker commands; never connects to a database.
const supported = process.platform === 'linux'
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'sg-restore-check-'))
  const backup = path.join(root,'20261002-120000'), bin = path.join(root,'bin'), uploads = path.join(root,'uploads')
  for (const dir of [backup,bin,uploads]) fs.mkdirSync(dir)
  fs.writeFileSync(path.join(uploads,'image.txt'),'test-only media')
  fs.writeFileSync(path.join(backup,'database.sql.gz'),gzipSync('SELECT 1;\n'))
  execFileSync('tar',['-czf',path.join(backup,'uploads.tar.gz'),'-C',uploads,'.'])
  fs.writeFileSync(path.join(backup,'backup-id.txt'),path.basename(backup)+'\n')
  const digest = file => createHash('sha256').update(fs.readFileSync(path.join(backup,file))).digest('hex')
  const checksums = () => fs.writeFileSync(path.join(backup,'SHA256SUMS'),['database.sql.gz','uploads.tar.gz'].map(file=>digest(file)+'  '+file+'\n').join(''))
  checksums()
  const log = path.join(root,'docker-calls.jsonl')
  fs.writeFileSync(path.join(bin,'docker'),`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2),scenario=process.env.SCENARIO;
fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify(args)+'\\n');
if(scenario==='sql-failure'&&args.includes('mysql')&&args.includes('exec'))process.exit(33);
if(scenario==='backend-failure'&&args.some(x=>x.includes('/health/ready')))process.exit(34);
if(scenario==='proxy-failure'&&args.some(x=>x.includes('/api/games')))process.exit(35);
process.exit(0);
`,{mode:0o755})
  const gzipPath = execFileSync('which',['gzip'],{encoding:'utf8'}).trim()
  fs.writeFileSync(path.join(bin,'gzip'),`#!/usr/bin/env node
const {spawnSync}=require('node:child_process');
if(process.env.SCENARIO==='decompress-failure'&&process.argv.includes('-dc'))process.exit(36);
const r=spawnSync(${JSON.stringify(gzipPath)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);
`,{mode:0o755})
  fs.writeFileSync(path.join(bin,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755})
  return {
    root,backup,uploads,checksums,
    run(scenario='success') {
      const r = spawnSync('sh',[path.join(__dirname,'restore.sh'),backup],{
        cwd:root,encoding:'utf8',timeout:30000,
        env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,MOCK_LOG:log,SCENARIO:scenario,I_UNDERSTAND_DATA_WILL_BE_OVERWRITTEN:'YES'},
      })
      const calls = fs.existsSync(log) ? fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
      return {...r,calls}
    },
    close() {
      if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('sg-restore-check-'))throw Error('Unsafe fixture path')
      fs.rmSync(root,{recursive:true,force:true})
    },
  }
}
function scenario(name, action) {
  test(name,{skip:!supported},()=>{const f=fixture();try{action(f)}finally{f.close()}})
}
scenario('valid backup completes only after backend and public API checks',f=>{
  const r=f.run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Restore completed/)
  assert.ok(r.calls.some(a=>a.some(x=>x.includes('/health/ready'))))
  assert.ok(r.calls.at(-1).some(x=>x.includes('/api/games')))
})
scenario('checksum mismatch refuses before any Docker action',f=>{
  fs.writeFileSync(path.join(f.backup,'database.sql.gz'),gzipSync('SELECT 2;\n'))
  const r=f.run();assert.notEqual(r.status,0);assert.equal(r.calls.length,0)
})
scenario('wrong backup id refuses before stopping the site',f=>{
  fs.writeFileSync(path.join(f.backup,'backup-id.txt'),'other-backup\n')
  const r=f.run();assert.notEqual(r.status,0);assert.equal(r.calls.length,0)
})
scenario('checksum manifest cannot reference another file',f=>{
  fs.appendFileSync(path.join(f.backup,'SHA256SUMS'),'a'.repeat(64)+'  ../secret\n')
  const r=f.run();assert.notEqual(r.status,0);assert.equal(r.calls.length,0)
})
scenario('uploads archive containing a symbolic link is refused before writes',f=>{
  fs.symlinkSync('/etc/passwd',path.join(f.uploads,'unsafe-link'))
  execFileSync('tar',['-czf',path.join(f.backup,'uploads.tar.gz'),'-C',f.uploads,'.']);f.checksums()
  const r=f.run();assert.notEqual(r.status,0);assert.equal(r.calls.length,0)
})
scenario('decompression failure cannot be hidden by a successful SQL command',f=>{
  const r=f.run('decompress-failure');assert.notEqual(r.status,0);assert.equal(r.calls.length,0)
})
for(const failure of ['sql-failure','backend-failure','proxy-failure'])scenario(failure+' stops services and never claims completion',f=>{
  const r=f.run(failure);assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/Restore completed/)
  assert.deepEqual(r.calls.at(-1),['compose','stop','server','nginx'])
})
