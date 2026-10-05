const H = require('./helpers')
const { randomUUID } = require('crypto')
module.exports = async function () {
  const { test, http, mkUser, makeToken, pool, assert } = H
  const aid = await mkUser('notify_admin', { role: 'admin' })
  const uid = await mkUser('notify_user')
  const banned = await mkUser('notify_banned', { status: 0 })
  await pool.execute('UPDATE users SET status=0 WHERE id=?', [banned])
  const token = makeToken(aid, 'notify_admin', 'admin')
  const userToken = makeToken(uid, 'notify_user', 'user')
  const payload = () => ({ scope: 'user', target_user_id: uid, content: '系统通知测试', request_id: randomUUID() })
  const send = body => http('POST', '/admin/notifications', { token, body })
  await test('通知权限：发送、预览和历史均只允许管理员', async () => {
    for (const [method, path] of [['POST', '/admin/notifications'], ['POST', '/admin/notifications/preview'], ['GET', '/admin/notifications']]) {
      assert.equal((await http(method, path, { token: userToken, body: method === 'POST' ? payload() : undefined })).status, 403)
      assert.equal((await http(method, path)).status, 401)
    }
  })
  await test('通知拒绝隐式群发、非法 ID、空内容和无请求编号', async () => {
    for (const body of [{ content: 'x' }, { ...payload(), scope: 'all' }, { ...payload(), target_user_id: true }, { ...payload(), content: ' ' }, { ...payload(), request_id: '' }, { ...payload(), content: '😀'.repeat(301) }]) assert.equal((await send(body)).status, 400)
  })
  await test('接收预览返回身份、排除封禁账号且不写入通知', async () => {
    const r = await http('POST', '/admin/notifications/preview', { token, body: { scope: 'user', target_user_id: uid } })
    assert.equal(r.status, 200)
    assert.equal(r.data.data.user.id, uid)
    assert.equal((await send({ ...payload(), target_user_id: banned })).status, 409)
    assert.equal((await send({ ...payload(), target_user_id: 99999999 })).status, 404)
    assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM notifications WHERE receiver_id=?', [uid]))[0][0].n, 0)
  })
  await test('并发相同请求只生成一个批次和一条通知，改内容复用编号返回409', async () => {
    const body = payload()
    const results = await Promise.all([send(body), send(body), send(body)])
    results.forEach(r => assert.equal(r.status, 200))
    assert.equal(new Set(results.map(r => r.data.data.id)).size, 1)
    assert.equal(results.filter(r => !r.data.data.replayed).length, 1)
    assert.equal((await pool.execute("SELECT COUNT(*) AS n FROM notifications WHERE target_type='system' AND target_id=?", [results[0].data.data.id]))[0][0].n, 1)
    assert.equal((await send({ ...body, content: '不同内容' })).status, 409)
  })
  await test('群发结果与启用人数一致，历史保留完整内容及发送人', async () => {
    const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM users WHERE status=1')
    const body = { scope: 'all', content: '😀'.repeat(300), request_id: randomUUID() }
    const r = await send(body)
    assert.equal(r.status, 200)
    assert.equal(r.data.data.count, n)
    const history = await http('GET', '/admin/notifications?pageSize=1', { token })
    assert.equal(history.data.data.list[0].id, r.data.data.id)
    assert.equal(history.data.data.list[0].content, body.content)
    assert.equal(history.data.data.list[0].admin_id, aid)
    assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM notifications WHERE receiver_id=?', [banned]))[0][0].n, 0)
  })
  await test('通知写入失败整体回滚，同一编号可以重新尝试', async () => {
    const body = payload()
    await pool.query(`CREATE TRIGGER test_broadcast_failure BEFORE INSERT ON notifications FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test broadcast failure'`)
    try { assert.equal((await send(body)).status, 500) }
    finally { await pool.query('DROP TRIGGER test_broadcast_failure') }
    assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM notification_batches WHERE request_id=?', [body.request_id]))[0][0].n, 0)
    assert.equal((await send(body)).status, 200)
  })
  await test('通知同秒稳定排序，不能修改他人已读状态', async () => {
    const list = (await http('GET', '/notifications?pageSize=100', { token: userToken })).data.data.list
    assert.ok(list.length > 1)
    for (let i = 1; i < list.length; i++) if (list[i].created_at === list[i - 1].created_at) assert.ok(list[i - 1].id > list[i].id)
    await http('PUT', `/notifications/${list[0].id}/read`, { token })
    assert.equal((await pool.execute('SELECT is_read FROM notifications WHERE id=?', [list[0].id]))[0][0].is_read, 0)
  })
  await test('每管理员一分钟最多十批，幂等重试不占额度', async () => {
    const bid = await mkUser('notify_limit', { role: 'admin' })
    const bt = makeToken(bid, 'notify_limit', 'admin')
    const body = payload()
    for (let i = 0; i < 10; i++) assert.equal((await http('POST', '/admin/notifications', { token: bt, body: i ? payload() : body })).status, 200)
    assert.equal((await http('POST', '/admin/notifications', { token: bt, body })).status, 200)
    assert.equal((await http('POST', '/admin/notifications', { token: bt, body: payload() })).status, 429)
  })
}
