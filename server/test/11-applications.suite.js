const H = require('./helpers')
module.exports = async function () {
  const { test, http, mkUser, makeToken, pool, assert } = H
  const [[admin]] = await pool.execute("SELECT id FROM users WHERE username='admin'")
  const adminToken = makeToken(admin.id, 'admin', 'admin')
  const uid = await mkUser('applicationflow')
  const token = makeToken(uid, 'applicationflow', 'user')
  const submit = reason => http('POST','/users/apply-creator',{token,body:{reason}})
  const decide = (id, action, reason) => http('PUT',`/admin/applications/${uid}/${action}`,{token:adminToken,body:{application_id:id,reason}})
  let first, second
  await test('申请拒绝空理由、错误类型及超长理由', async () => {
    for (const reason of [undefined, null, '', '  ', 1, {}, [], 'x'.repeat(501)]) assert.equal((await submit(reason)).status,400)
  })
  await test('并发申请只产生一条待审记录', async () => {
    const results = await Promise.all([submit('理由一'),submit('理由二')])
    assert.deepEqual(results.map(r=>r.status).sort(),[200,400])
    first = results.find(r=>r.status===200).data.data.id
    const [[{n}]] = await pool.execute('SELECT COUNT(*) n FROM creator_applications WHERE user_id=?',[uid])
    assert.equal(n,1)
  })
  await test('驳回必填原因，审核记录与用户状态可回读', async () => {
    assert.equal((await decide(first,'reject','')).status,400)
    assert.equal((await decide(first,'reject','请补充攻略方向')).status,200)
    const me = (await http('GET','/users/me',{token})).data.data
    assert.equal(me.apply_status,'rejected')
    assert.equal(me.application.reject_reason,'请补充攻略方向')
    const [[row]] = await pool.execute('SELECT reviewer_id,reviewed_at FROM creator_applications WHERE id=?',[first])
    assert.equal(row.reviewer_id,admin.id)
    assert.ok(row.reviewed_at)
  })
  await test('重新申请后旧申请不能通过新一轮申请', async () => {
    second = (await submit('补充后的方向')).data.data.id
    assert.notEqual(first,second)
    assert.equal((await decide(first,'approve')).status,409)
    const me = (await http('GET','/users/me',{token})).data.data
    assert.equal(me.apply_status,'pending')
    assert.equal(me.application.id,second)
  })
  await test('封禁申请人不能通过，解封后并发审核只成功一次', async () => {
    await pool.execute('UPDATE users SET status=0 WHERE id=?',[uid])
    assert.equal((await decide(second,'approve')).status,409)
    await pool.execute('UPDATE users SET status=1 WHERE id=?',[uid])
    const results = await Promise.all([decide(second,'approve'),decide(second,'approve')])
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
    const [[{n}]] = await pool.execute("SELECT COUNT(*) n FROM notifications WHERE receiver_id=? AND target_type='creatorship' AND target_id=?",[uid,second])
    assert.equal(n,1)
  })
  await test('已处理列表包含各轮审核，普通用户无审核权限', async () => {
    const rows = (await http('GET','/admin/applications?status=processed',{token:adminToken})).data.data.list
    assert.ok(rows.some(a=>a.id===second && a.status==='approved'))
    assert.equal((await http('GET','/admin/applications',{token})).status,403)
  })
  await test('申请通知失败时角色、申请记录和唯一占位一起回滚', async () => {
    const other = await mkUser('applicationrollback')
    const otherToken = makeToken(other,'applicationrollback','user')
    const id = (await http('POST','/users/apply-creator',{token:otherToken,body:{reason:'测试回滚'}})).data.data.id
    await pool.query(`CREATE TRIGGER test_application_notification_failure BEFORE INSERT ON notifications FOR EACH ROW
      BEGIN IF NEW.target_type='creatorship' AND NEW.target_id=${id} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test application rollback'; END IF; END`)
    try {
      assert.equal((await http('PUT',`/admin/applications/${other}/approve`,{token:adminToken,body:{application_id:id}})).status,500)
      const [[row]] = await pool.execute('SELECT status,pending_user_id,reviewed_at FROM creator_applications WHERE id=?',[id])
      assert.equal(row.status,'pending')
      assert.equal(row.pending_user_id,other)
      assert.equal(row.reviewed_at,null)
      const me = (await http('GET','/users/me',{token:otherToken})).data.data
      assert.equal(me.role,'user')
      assert.equal(me.apply_status,'pending')
    } finally { await pool.query('DROP TRIGGER test_application_notification_failure') }
  })
  await test('历史申请迁移保留理由、不伪造时间且可安全重跑', async () => {
    const legacyUser = await mkUser('applicationlegacy')
    await pool.execute("UPDATE users SET apply_status='rejected',apply_reason='历史申请理由' WHERE id=?",[legacyUser])
    const migration = require('../db/migrations/006_creator_applications')
    await migration.up(pool)
    await migration.up(pool)
    const [rows] = await pool.execute('SELECT * FROM creator_applications WHERE user_id=?',[legacyUser])
    assert.equal(rows.length,1)
    assert.equal(rows[0].reason,'历史申请理由')
    assert.equal(rows[0].submitted_at,null)
    assert.equal(rows[0].reviewer_id,null)
    assert.equal(rows[0].legacy,1)
  })
}
