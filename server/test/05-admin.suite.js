// 05 管理模块：审核/申请审批/用户管理/删除级联/公告/统计/系统通知/举报处理/操作日志审计
const H = require('./helpers')

module.exports = async function adminSuite() {
  console.log('\n[05] 管理模块 /api/admin')
  const { test, http, mkUser, mkPost, makeToken, adminToken, pool, created, trackFile, expectFile, SEQ } = H
  let adminTok = ''
  await adminToken().then(t => adminTok = t)
  const authorId = await mkUser('adauthor', { role: 'creator', apply: 'approved' })
  const authorTok = makeToken(authorId, 'adauthor', 'creator')

  // ---- 待审列表与审核（P0-4）----
  await test('GET /admin/posts/pending → 200 分页', async () => {
    const r = await http('GET', '/admin/posts/pending', { token: adminTok })
    H.assert.equal(r.status, 200)
    H.assert.ok('total' in r.data.data && 'list' in r.data.data)
  })
  await test('approve 不存在 → 404（P0-4 修复：原 200）', async () => {
    const r = await http('PUT', '/admin/posts/99999999/approve', { token: adminTok })
    H.assert.equal(r.status, 404)
  })
  await test('approve draft → 400 禁绕过直发（P0-4 修复）', async () => {
    const pid = await mkPost(authorId, { status: 'draft' })
    const r = await http('PUT', `/admin/posts/${pid}/approve`, { token: adminTok })
    H.assert.equal(r.status, 400)
  })
  await test('approve pending → published + 作者收审核通知', async () => {
    const pid = await mkPost(authorId, { status: 'pending' })
    const r = await http('PUT', `/admin/posts/${pid}/approve`, { token: adminTok })
    H.assert.equal(r.status, 200)
    const [[p]] = await pool.execute('SELECT status FROM posts WHERE id=?', [pid])
    H.assert.equal(p.status, 'published')
    const n = await http('GET', '/notifications', { token: authorTok })
    H.assert.ok(n.data.data.list.some(x => x.type === 'audit' && x.target_id === pid))
  })
  await test('reject pending → rejected + 原因落库', async () => {
    const pid = await mkPost(authorId, { status: 'pending' })
    const r = await http('PUT', `/admin/posts/${pid}/reject`, { token: adminTok, body: { reason: '内容太水' } })
    H.assert.equal(r.status, 200)
    const [[p]] = await pool.execute('SELECT status, reject_reason FROM posts WHERE id=?', [pid])
    H.assert.equal(p.status, 'rejected')
    H.assert.equal(p.reject_reason, '内容太水')
  })
  await test('reject 空原因 → 400；超 200 字 → 400（P1-1 修复）', async () => {
    const pid = await mkPost(authorId, { status: 'pending' })
    H.assert.equal((await http('PUT', `/admin/posts/${pid}/reject`, { token: adminTok, body: { reason: '' } })).status, 400)
    H.assert.equal((await http('PUT', `/admin/posts/${pid}/reject`, { token: adminTok, body: { reason: 'x'.repeat(201) } })).status, 400)
  })
  await test('reject published → 400 禁打回（P0-4 修复）', async () => {
    const pid = await mkPost(authorId, { status: 'published' })
    H.assert.equal((await http('PUT', `/admin/posts/${pid}/reject`, { token: adminTok, body: { reason: 'x' } })).status, 400)
  })

  // ---- 创作者申请审批（P0-1）----
  await test('GET /admin/applications → 200 且不泄漏 password（坑2 回归）', async () => {
    const applier = await mkUser('adapplier')
    await pool.execute("UPDATE users SET apply_status='pending' WHERE id=?", [applier])
    const r = await http('GET', '/admin/applications', { token: adminTok })
    H.assert.equal(r.status, 200)
    const hit = r.data.data.list.find(u => u.id === applier)
    H.assert.ok(hit, '申请应出现在列表')
    H.assert.ok(!('password' in hit), '严禁泄漏密码哈希')
  })
  await test('approve 申请 → role=creator + 申请人收通知', async () => {
    const applier = await mkUser('adapplier2')
    await pool.execute("UPDATE users SET apply_status='pending' WHERE id=?", [applier])
    const r = await http('PUT', `/admin/applications/${applier}/approve`, { token: adminTok })
    H.assert.equal(r.status, 200)
    const [[u]] = await pool.execute('SELECT role, apply_status FROM users WHERE id=?', [applier])
    H.assert.equal(u.role, 'creator')
    H.assert.equal(u.apply_status, 'approved')
    const n = await http('GET', '/notifications', { token: makeToken(applier, 'adapplier2', 'user') })
    H.assert.ok(n.data.data.list.some(x => x.type === 'audit' && x.target_type === 'creatorship'))
  })
  await test('approve 不存在 → 404（P0-1 修复：原 500）', async () => {
    H.assert.equal((await http('PUT', '/admin/applications/99999999/approve', { token: adminTok })).status, 404)
  })
  await test('approve 未申请 → 400；admin 目标 → 400 防降级（P0-1 修复）', async () => {
    const plain = await mkUser('adplain')
    H.assert.equal((await http('PUT', `/admin/applications/${plain}/approve`, { token: adminTok })).status, 400)
    const [[adminRow]] = await pool.execute("SELECT id FROM users WHERE username='admin'")
    const r = await http('PUT', `/admin/applications/${adminRow.id}/approve`, { token: adminTok })
    H.assert.equal(r.status, 400)
    const [[adm]] = await pool.execute("SELECT role FROM users WHERE username='admin'")
    H.assert.equal(adm.role, 'admin', 'admin 角色必须保持')
  })
  await test('reject 申请 → apply_status=rejected；已驳回再 reject → 400', async () => {
    const applier = await mkUser('adapplier3')
    await pool.execute("UPDATE users SET apply_status='pending' WHERE id=?", [applier])
    H.assert.equal((await http('PUT', `/admin/applications/${applier}/reject`, { token: adminTok })).status, 200)
    const [[u]] = await pool.execute('SELECT apply_status FROM users WHERE id=?', [applier])
    H.assert.equal(u.apply_status, 'rejected')
    H.assert.equal((await http('PUT', `/admin/applications/${applier}/reject`, { token: adminTok })).status, 400)
  })

  // ---- 用户管理 ----
  await test('GET /admin/users → 200 分页 + role/keyword 过滤', async () => {
    const r = await http('GET', '/admin/users', { token: adminTok })
    H.assert.equal(r.status, 200)
    const byRole = await http('GET', '/admin/users?role=admin', { token: adminTok })
    H.assert.ok(byRole.data.data.list.every(u => u.role === 'admin'))
    const byKw = await http('GET', `/admin/users?keyword=${encodeURIComponent('adauthor_' + SEQ)}`, { token: adminTok })
    H.assert.ok(byKw.data.data.list.some(u => u.id === authorId))
  })
  await test('封禁 → status=0 且 token 立即失效；解封恢复', async () => {
    const victim = await mkUser('advictim')
    const vTok = makeToken(victim, 'advictim', 'user')
    const ban = await http('PUT', `/admin/users/${victim}/ban`, { token: adminTok })
    H.assert.equal(ban.status, 200)
    const [[u]] = await pool.execute('SELECT status FROM users WHERE id=?', [victim])
    H.assert.equal(u.status, 0)
    H.assert.equal((await http('GET', '/users/me', { token: vTok })).status, 403, '封禁后 token 应 403')
    H.assert.equal((await http('PUT', `/admin/users/${victim}/ban`, { token: adminTok })).status, 200)
    H.assert.equal((await http('GET', '/users/me', { token: vTok })).status, 200, '解封后恢复')
  })
  await test('ban admin → 400 防锁死', async () => {
    const [[adminRow]] = await pool.execute("SELECT id FROM users WHERE username='admin'")
    const r = await http('PUT', `/admin/users/${adminRow.id}/ban`, { token: adminTok })
    H.assert.equal(r.status, 400)
  })
  await test('删除用户：不存在 404 / admin 400 / 自己 400 / 公告作者 400', async () => {
    H.assert.equal((await http('DELETE', '/admin/users/99999999', { token: adminTok })).status, 404)
    const [[adminRow]] = await pool.execute("SELECT id, username FROM users WHERE username='admin'")
    H.assert.equal((await http('DELETE', `/admin/users/${adminRow.id}`, { token: adminTok })).status, 400)
    H.assert.equal((await http('DELETE', `/admin/users/${adminRow.id}`, { token: adminTok })).status, 400)
    const annAuthor = await mkUser('adannauthor')
    await pool.execute('INSERT INTO announcements (title, content, author_id, status) VALUES (?,?,?,?)', ['测试公告', '内容', annAuthor, 'draft'])
    const r = await http('DELETE', `/admin/users/${annAuthor}`, { token: adminTok })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '该用户发布过公告，不能删除')
    await pool.execute('DELETE FROM announcements WHERE author_id=?', [annAuthor])
  })
  await test('删除用户级联清空 + 磁盘文件清理（P2-5 修复）', async () => {
    const victim = await mkUser('addeluser')
    const vTok = makeToken(victim, 'addeluser', 'user')
    // 头像 + 文章（内嵌图 + 封面）
    const up = await http('POST', '/users/me/avatar', { token: vTok, form: H.pngForm('del-avatar.png') })
    H.assert.equal(up.status, 200)
    const avatarUrl = trackFile(up.data.data.url)
    const upImg = await http('POST', '/media/upload/image', { token: authorTok, form: H.pngForm('del-img.png') })
    const imgUrl = trackFile(upImg.data.data.url)
    expectFile(avatarUrl, true); expectFile(imgUrl, true)
    const pid = await mkPost(victim, { status: 'published', cover: imgUrl, content: `<p><img src="${imgUrl}" alt="i"></p>` })
    await pool.execute('INSERT INTO media (post_id, url, type, sort_order) VALUES (?,?,?,?)', [pid, imgUrl, 'image', 1])
    const r = await http('DELETE', `/admin/users/${victim}`, { token: adminTok })
    H.assert.equal(r.status, 200)
    H.assert.ok(r.data.data.post_count >= 1)
    const [[u]] = await pool.execute('SELECT COUNT(*) c FROM users WHERE id=?', [victim])
    H.assert.equal(u.c, 0)
    const [[p]] = await pool.execute('SELECT COUNT(*) c FROM posts WHERE user_id=?', [victim])
    H.assert.equal(p.c, 0)
    const [[m]] = await pool.execute('SELECT COUNT(*) c FROM media WHERE post_id=?', [pid])
    H.assert.equal(m.c, 0)
    expectFile(avatarUrl, false)
    expectFile(imgUrl, false)
    H.assert.equal((await http('GET', '/users/me', { token: vTok })).status, 401, '删除后旧 token 应失效')
  })

  // ---- 公告 ----
  let annId = null
  await test('公告 CRUD 全链路', async () => {
    const c = await http('POST', '/admin/announcements', { token: adminTok, body: { title: `公告_${SEQ}`, content: '欢迎' } })
    H.assert.equal(c.status, 200)
    annId = c.data.data.id
    created.announcements.push(annId)
    H.assert.equal((await http('PUT', `/admin/announcements/${annId}`, { token: adminTok, body: { title: `公告改_${SEQ}`, content: '更新' } })).status, 200)
    H.assert.equal((await http('PUT', `/admin/announcements/${annId}/publish`, { token: adminTok })).status, 200)
    const latest = await http('GET', '/announcements/latest')
    H.assert.equal(latest.data.data.id, annId)
    H.assert.equal(latest.data.data.status, 'published')
    H.assert.equal((await http('PUT', `/admin/announcements/${annId}/archive`, { token: adminTok })).status, 200)
    H.assert.equal((await http('GET', '/announcements/latest')).data.data, null, '归档后无 published 公告')
  })
  await test('publish 新公告时旧 published 自动 archived', async () => {
    const a1 = await http('POST', '/admin/announcements', { token: adminTok, body: { title: 'A1', content: 'x' } })
    const a2 = await http('POST', '/admin/announcements', { token: adminTok, body: { title: 'A2', content: 'x' } })
    created.announcements.push(a1.data.data.id, a2.data.data.id)
    await http('PUT', `/admin/announcements/${a1.data.data.id}/publish`, { token: adminTok })
    await http('PUT', `/admin/announcements/${a2.data.data.id}/publish`, { token: adminTok })
    const [[r1]] = await pool.execute('SELECT status FROM announcements WHERE id=?', [a1.data.data.id])
    const [[r2]] = await pool.execute('SELECT status FROM announcements WHERE id=?', [a2.data.data.id])
    H.assert.equal(r1.status, 'archived')
    H.assert.equal(r2.status, 'published')
  })
  await test('公告缺字段/超长 → 400（P1-1 修复）', async () => {
    H.assert.equal((await http('POST', '/admin/announcements', { token: adminTok, body: { title: 'x' } })).status, 400)
    H.assert.equal((await http('POST', '/admin/announcements', { token: adminTok, body: { title: 'x'.repeat(201), content: 'x' } })).status, 400)
    H.assert.equal((await http('POST', '/admin/announcements', { token: adminTok, body: { title: 'x', content: '长'.repeat(22000) } })).status, 400)
  })
  await test('删除公告 → 200', async () => {
    const a = await http('POST', '/admin/announcements', { token: adminTok, body: { title: 'AD', content: 'x' } })
    H.assert.equal((await http('DELETE', `/admin/announcements/${a.data.data.id}`, { token: adminTok })).status, 200)
  })

  // ---- 统计 / 系统通知 / 举报处理 ----
  await test('GET /admin/stats → 200', async () => {
    const r = await http('GET', '/admin/stats', { token: adminTok })
    H.assert.equal(r.status, 200)
    H.assert.ok('totalUsers' in r.data.data && 'totalPosts' in r.data.data && 'totalViews' in r.data.data)
  })
  await test('系统通知全员 → 200 count>0 且落库 type=system', async () => {
    const r = await http('POST', '/admin/notifications', { token: adminTok, body: { content: `系统公告_${SEQ}` } })
    H.assert.equal(r.status, 200)
    H.assert.ok(r.data.data.count >= 1)
    const [[n]] = await pool.execute('SELECT COUNT(*) c FROM notifications WHERE content=? AND type=? AND sender_id IS NULL', [`系统公告_${SEQ}`, 'system'])
    H.assert.ok(n.c >= 1)
    // 测试残留清理：发给真实 admin 的系统通知不在级联范围，手动清
    await pool.execute('DELETE FROM notifications WHERE content=?', [`系统公告_${SEQ}`])
  })
  await test('定向通知不存在用户 → 404（P1-3 修复：原 500）', async () => {
    const r = await http('POST', '/admin/notifications', { token: adminTok, body: { content: 'x', target_user_id: 99999999 } })
    H.assert.equal(r.status, 404)
  })
  await test('通知超 300 字 → 400（P1-1 修复）', async () => {
    H.assert.equal((await http('POST', '/admin/notifications', { token: adminTok, body: { content: 'x'.repeat(301) } })).status, 400)
  })
  await test('举报列表 + resolve 处理（白名单/备注长度）', async () => {
    const pub = await mkPost(authorId, { status: 'published' })
    await pool.execute('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?,?,?,?)', [authorId, 'post', pub, '[测试] 原因'])
    const list = await http('GET', '/admin/reports', { token: adminTok })
    const rep = list.data.data.list.find(x => x.target_id === pub)
    H.assert.ok(rep)
    H.assert.equal((await http('PUT', `/admin/reports/${rep.id}/resolve`, { token: adminTok, body: { status: 'resolved', handler_note: '属实' } })).status, 200)
    const [[rr]] = await pool.execute('SELECT status, handler_note FROM reports WHERE id=?', [rep.id])
    H.assert.equal(rr.status, 'resolved')
    H.assert.equal(rr.handler_note, '属实')
    H.assert.equal((await http('PUT', `/admin/reports/${rep.id}/resolve`, { token: adminTok, body: { status: 'bogus' } })).status, 400)
    H.assert.equal((await http('PUT', `/admin/reports/${rep.id}/resolve`, { token: adminTok, body: { status: 'dismissed', handler_note: 'x'.repeat(301) } })).status, 400)
  })

  // ---- 操作日志审计（D23 回归 + P0-1 审批记录）----
  await test('GET /admin/logs → 200 分页筛选 + ban_user 审计落库', async () => {
    const victim = await mkUser('adloguser')
    await http('PUT', `/admin/users/${victim}/ban`, { token: adminTok })
    const r = await http('GET', '/admin/logs?action=ban_user', { token: adminTok })
    H.assert.equal(r.status, 200)
    const hit = r.data.data.list.find(x => x.target_id === victim)
    H.assert.ok(hit, '封禁操作应被审计')
    H.assert.equal(hit.admin_username, 'admin')
    H.assert.equal(hit.method, 'PUT')
    H.assert.ok(hit.path.includes(`/users/${victim}/ban`))
    // 审计表只增不改无级联：测试产生的审计记录手动清理（零残留）
    await pool.execute('DELETE FROM operation_logs WHERE target_type=? AND target_id=?', ['user', victim])
  })
  await test('logs 筛选：keyword/start/end/admin_id 参数生效', async () => {
    const kw = await http('GET', `/admin/logs?keyword=${encodeURIComponent('封禁')}`, { token: adminTok })
    H.assert.equal(kw.status, 200)
    H.assert.ok(kw.data.data.list.every(x => x.detail.includes('封禁')))
    const ranged = await http('GET', '/admin/logs?start=2000-01-01&end=2000-01-02', { token: adminTok })
    H.assert.equal(ranged.data.data.total, 0)
    const [[adminRow]] = await pool.execute("SELECT id FROM users WHERE username='admin'")
    const byAdmin = await http('GET', `/admin/logs?admin_id=${adminRow.id}`, { token: adminTok })
    H.assert.ok(byAdmin.data.data.list.every(x => x.admin_id === adminRow.id))
  })
  await test('非 admin 访问管理接口 → 403', async () => {
    const plain = await mkUser('adplain2')
    H.assert.equal((await http('GET', '/admin/logs', { token: makeToken(plain, 'adplain2', 'user') })).status, 403)
  })
}
