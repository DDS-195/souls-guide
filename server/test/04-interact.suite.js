// 04 互动模块：通知（unread/单条已读/全部已读）/收藏过滤/关注粉丝列表/举报
const H = require('./helpers')

module.exports = async function interactSuite() {
  console.log('\n[04] 互动模块 /api')
  const { test, http, mkUser, mkPost, makeToken, pool, SEQ } = H
  const authorId = await mkUser('iauthor', { role: 'creator', apply: 'approved' })
  const readerId = await mkUser('ireader')
  const authorTok = makeToken(authorId, 'iauthor', 'creator')
  const readerTok = makeToken(readerId, 'ireader', 'user')

  // ---- 通知 ----
  await test('GET /notifications → 200 含 unread 分页', async () => {
    const pub = await mkPost(authorId, { status: 'published' })
    await http('POST', `/posts/${pub}/like`, { token: readerTok })
    await http('POST', `/posts/${pub}/comments`, { token: readerTok, body: { content: 'hi' } })
    const r = await http('GET', '/notifications', { token: authorTok })
    H.assert.equal(r.status, 200)
    H.assert.ok('unread' in r.data.data && 'total' in r.data.data && 'list' in r.data.data)
    H.assert.ok(r.data.data.unread >= 2)
    H.assert.ok(r.data.data.list.some(n => n.type === 'like'))
    H.assert.ok(r.data.data.list.some(n => n.type === 'comment'))
  })
  await test('无 token → 401', async () => {
    H.assert.equal((await http('GET', '/notifications')).status, 401)
  })
  await test('单条已读 → 200 后 unread-1（2026-08-09 契约）', async () => {
    const list = (await http('GET', '/notifications', { token: authorTok })).data.data
    const unreadBefore = list.unread
    const first = list.list.find(n => n.is_read === 0)
    const r = await http('PUT', `/notifications/${first.id}/read`, { token: authorTok })
    H.assert.equal(r.status, 200)
    const after = (await http('GET', '/notifications', { token: authorTok })).data.data
    H.assert.equal(after.unread, unreadBefore - 1)
  })
  await test('unread=1 → 仅返回未读通知且分页总数一致', async () => {
    const result = (await http('GET', '/notifications?unread=1&pageSize=1', { token: authorTok })).data.data
    H.assert.equal(result.pageSize, 1)
    H.assert.ok(result.list.every(notification => notification.is_read === 0))
    H.assert.equal(result.total, result.unread)
  })
  await test('全部已读 → unread=0', async () => {
    const r = await http('PUT', '/notifications/read-all', { token: authorTok })
    H.assert.equal(r.status, 200)
    const after = (await http('GET', '/notifications', { token: authorTok })).data.data
    H.assert.equal(after.unread, 0)
  })

  // ---- 收藏（P2-1：只含 published）----
  await test('收藏列表只返回 published（P2-1 修复）', async () => {
    const pub = await mkPost(authorId, { status: 'published' })
    const drf = await mkPost(authorId, { status: 'draft' })
    await http('POST', `/posts/${pub}/favorite`, { token: readerTok })
    await http('POST', `/posts/${drf}/favorite`, { token: readerTok })
    const r = await http('GET', '/favorites', { token: readerTok })
    H.assert.equal(r.status, 200)
    H.assert.ok(r.data.data.list.every(p => p.id === pub), '只应出现 published 收藏')
    H.assert.ok(!r.data.data.list.some(p => p.id === drf), 'draft 收藏不应出现')
    H.assert.ok(r.data.data.list.every(p => 'avatar' in p), '收藏卡片含 avatar（2026-08-09 修复回归）')
  })

  // ---- 关注/粉丝列表 ----
  await test('followers/following 列表分页含 followed_at（公开）', async () => {
    await http('POST', `/follows/${authorId}`, { token: readerTok })
    const fers = await http('GET', `/users/${authorId}/followers`)
    H.assert.equal(fers.status, 200)
    H.assert.ok(fers.data.data.list.some(u => u.id === readerId))
    H.assert.ok(fers.data.data.list.every(u => 'followed_at' in u))
    const fing = await http('GET', `/users/${readerId}/following`)
    H.assert.ok(fing.data.data.list.some(u => u.id === authorId))
    await http('POST', `/follows/${authorId}`, { token: readerTok }) // 复原（取消关注）
  })

  // ---- 举报（D21）----
  let reportId = null
  await test('提交举报 → 200 落库 pending', async () => {
    const pub = await mkPost(authorId, { status: 'published' })
    const r = await http('POST', '/reports', { token: readerTok, body: { target_type: 'post', target_id: pub, reason: '[广告营销] 测试举报' } })
    H.assert.equal(r.status, 200)
    reportId = r.data.data.id
    const [[rep]] = await pool.execute('SELECT status, reporter_id, target_type, target_id, reason FROM reports WHERE id=?', [reportId])
    H.assert.equal(rep.status, 'pending')
    H.assert.equal(rep.reporter_id, readerId)
    H.assert.equal(rep.reason, '[广告营销] 测试举报')
  })
  await test('非法 target_type → 400', async () => {
    const r = await http('POST', '/reports', { token: readerTok, body: { target_type: 'game', target_id: 1, reason: 'x' } })
    H.assert.equal(r.status, 400)
  })
  await test('目标不存在 → 400', async () => {
    const r = await http('POST', '/reports', { token: readerTok, body: { target_type: 'post', target_id: 99999999, reason: 'x' } })
    H.assert.equal(r.status, 400)
  })
  await test('空原因 → 400；超 500 字 → 400', async () => {
    H.assert.equal((await http('POST', '/reports', { token: readerTok, body: { target_type: 'post', target_id: 1, reason: '  ' } })).status, 400)
    H.assert.equal((await http('POST', '/reports', { token: readerTok, body: { target_type: 'post', target_id: 1, reason: 'x'.repeat(501) } })).status, 400)
  })
  await test('举报无 token → 401', async () => {
    H.assert.equal((await http('POST', '/reports', { body: { target_type: 'post', target_id: 1, reason: 'x' } })).status, 401)
  })
}
