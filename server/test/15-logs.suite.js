const H = require('./helpers')
const fs = require('fs/promises')
const path = require('path')
const os = require('os')
const zlib = require('zlib')
module.exports = async function () {
  const { test,assert,http,pool,mkUser,makeToken } = H
  const token = await H.adminToken()
  await test('日志查询拒绝非法日期、倒置范围及非法筛选', async () => {
    for (const query of ['start=2026-02-30','start=bad','start=2026-02-02&end=2026-01-01','admin_id=abc','target_id=-1','action=unknown','target_type=secret','keyword='+ 'a'.repeat(201)]) {
      assert.equal((await http('GET','/admin/logs?'+query,{token})).status,400,query)
    }
  })
  await test('封禁解封日志语义正确，带请求编号和事务事件', async () => {
    const uid = await mkUser('logs_user')
    for (const [status,version] of [[0,1],[1,2]]) assert.equal((await http('PUT',`/admin/users/${uid}/ban`,{token,headers:{'X-Request-Id':'audit-regression-'+version},body:{status,version,reason:'核对日志语义'}})).status,200)
    const r = await http('GET',`/admin/logs?target_type=user&target_id=${uid}`,{token})
    assert.deepEqual(r.data.data.list.map(x=>x.action),['unban_user','ban_user'])
    assert.equal(r.data.data.list[0].request_id,'audit-regression-2')
    assert.ok(r.data.data.list[0].event_key.startsWith('user-event:'))
    const byRequest = await http('GET','/admin/logs?request_id=audit-regression-1',{token})
    assert.equal(byRequest.data.data.total,1)
  })
  await test('审计写入失败使封禁事务回滚', async () => {
    const uid = await mkUser('logs_rollback')
    await pool.query("CREATE TRIGGER test_operation_failure BEFORE INSERT ON operation_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='operation audit failure'")
    try { assert.equal((await http('PUT',`/admin/users/${uid}/ban`,{token,body:{status:0,version:1,reason:'测试回滚'}})).status,500) }
    finally { await pool.query('DROP TRIGGER test_operation_failure') }
    assert.equal((await pool.execute('SELECT status FROM users WHERE id=?',[uid]))[0][0].status,1)
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM user_management_events WHERE user_id=?',[uid]))[0][0].n,0)
  })
  await test('通知幂等重试只保存一条发送审计且关联批次', async () => {
    const aid = await mkUser('logs_sender',{role:'admin'})
    const uid = await mkUser('logs_receiver')
    const t = makeToken(aid,'logs_sender','admin')
    const body = { scope:'user',target_user_id:uid,content:'通知幂等审计',request_id:require('crypto').randomUUID() }
    const first = await http('POST','/admin/notifications',{token:t,body})
    assert.equal(first.status,200)
    assert.equal((await http('POST','/admin/notifications',{token:t,body})).status,200)
    const r = await http('GET',`/admin/logs?admin_id=${aid}&action=send_notification`,{token})
    assert.equal(r.data.data.total,1)
    assert.equal(r.data.data.list[0].target_id,first.data.data.id)
  })
  await test('安全压缩：损坏的压缩副本不能导致原日志丢失；并发维护互斥', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(),'souls-log-test-'))
    try {
      const date = new Date(Date.now()-2*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})
      const raw = path.join(dir,'access-'+date+'.log')
      await fs.writeFile(raw,'original log\n')
      await fs.writeFile(raw+'.gz','broken archive')
      const { maintainLogs } = require('../src/utils/logWriter')
      await maintainLogs(dir,'access')
      assert.equal(await fs.readFile(raw,'utf8'),'original log\n')
      await fs.unlink(raw+'.gz')
      await Promise.all([maintainLogs(dir,'access'),maintainLogs(dir,'access')])
      assert.equal(zlib.gunzipSync(await fs.readFile(raw+'.gz')).toString(),'original log\n')
      if (process.platform === 'win32') assert.equal(await fs.readFile(raw,'utf8'),'original log\n')
      else await assert.rejects(()=>fs.access(raw))
    } finally {
      if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('souls-log-test-')) await fs.rm(dir,{recursive:true,force:true})
    }
  })
  await test('遗留锁文件不阻止维护；活跃内核锁跳过，持有者退出后自动恢复', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(),'souls-log-test-'))
    let holder
    try {
      const date = new Date(Date.now()-2*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})
      const raw = path.join(dir,'access-'+date+'.log')
      const lock = path.join(dir,'.access-maintenance.lock')
      await fs.writeFile(lock,'old crashed process')
      await fs.writeFile(raw,'recover after stale lock\n')
      const { maintainLogs } = require('../src/utils/logWriter')
      await maintainLogs(dir,'access')
      assert.equal(zlib.gunzipSync(await fs.readFile(raw+'.gz')).toString(),'recover after stale lock\n')
      if (process.platform === 'win32') return
      await fs.unlink(raw+'.gz')
      await fs.writeFile(raw,'recover after killed owner\n')
      const { spawn } = require('child_process')
      holder = spawn('flock',['--exclusive','--no-fork',lock,process.execPath,'-e','console.log("LOCKED");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']})
      await new Promise((resolve,reject) => {
        const timeout = setTimeout(()=>reject(new Error('flock readiness timeout')),5000)
        holder.once('error',err=>{clearTimeout(timeout);reject(err)})
        holder.stdout.once('data',()=>{clearTimeout(timeout);resolve()})
        holder.once('exit',code=>{clearTimeout(timeout);reject(new Error('flock exited early: '+code))})
      })
      await maintainLogs(dir,'access')
      assert.equal(await fs.readFile(raw,'utf8'),'recover after killed owner\n')
      await assert.rejects(()=>fs.access(raw+'.gz'))
      const closed = new Promise(resolve=>holder.once('close',resolve))
      holder.kill('SIGKILL')
      await closed
      holder = null
      await maintainLogs(dir,'access')
      assert.equal(zlib.gunzipSync(await fs.readFile(raw+'.gz')).toString(),'recover after killed owner\n')
      await assert.rejects(()=>fs.access(raw))
    } finally {
      if (holder) {
        const closed = new Promise(resolve=>holder.once('close',resolve))
        holder.kill('SIGKILL')
        await closed
      }
      if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('souls-log-test-')) await fs.rm(dir,{recursive:true,force:true})
    }
  })
  await test('写入器复用、异步写入与常见凭证脱敏', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(),'souls-log-test-'))
    const { createLogWriter } = require('../src/utils/logWriter')
    const writer = createLogWriter(dir,'test')
    try {
      assert.equal(writer,createLogWriter(dir,'test'))
      writer.write('one\n'); writer.write('two\n'); await writer.flush()
      const name = (await fs.readdir(dir)).find(x=>x.endsWith('.log'))
      assert.equal(await fs.readFile(path.join(dir,name),'utf8'),'one\ntwo\n')
      const {safePath,redact} = require('../src/utils/logRedaction')
      assert.equal(safePath('/api/test?token=secret'),'/api/test')
      assert.ok(!redact('password=private Bearer abcdef').includes('private'))
      assert.ok(!redact('password=private Bearer abcdef').includes('abcdef'))
    } finally {
      await writer.close()
      if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('souls-log-test-')) await fs.rm(dir,{recursive:true,force:true})
    }
  })
}
