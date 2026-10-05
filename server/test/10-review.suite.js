const H = require('./helpers')
module.exports = async function reviewSuite() {
  const { test, http, mkUser, mkPost, makeToken, adminToken, pool, assert } = H
  const admin = await adminToken()
  const author = await mkUser('reviewauthor', { role: 'creator', apply: 'approved' })
  const token = makeToken(author, 'reviewauthor', 'creator')
  const review = id => http('GET', `/admin/posts/${id}/review`, { token: admin })
  const approve = (id, version) => http('PUT', `/admin/posts/${id}/approve`, { token: admin, body: { content_version: version } })
  const state = async id => (await pool.execute('SELECT * FROM posts WHERE id=?', [id]))[0][0]

  await test('审阅详情权限及完整内容；待审列表不携带正文', async () => {
    const id = await mkPost(author, { status: 'pending' })
    assert.equal((await http('GET', `/admin/posts/${id}/review`)).status, 401)
    assert.equal((await http('GET', `/admin/posts/${id}/review`, { token })).status, 403)
    const r = await review(id)
    assert.equal(r.status, 200)
    assert.equal(r.data.data.content_version, 1)
    assert.ok(typeof r.data.data.content === 'string')
    assert.ok(Array.isArray(r.data.data.media) && Array.isArray(r.data.data.tags))
    const list = await http('GET', '/admin/posts/pending?pageSize=50', { token: admin })
    assert.ok(list.data.data.list.every(p => !('content' in p) && 'game_name' in p))
  })
  await test('审核参数严格校验，非文本原因返回 400', async () => {
    const id = await mkPost(author, { status: 'pending' })
    for (const value of [undefined, '1', 0, -1, 1.5, {}]) assert.equal((await approve(id, value)).status, 400)
    for (const reason of [12, {}, [], '', '  ']) {
      assert.equal((await http('PUT', `/admin/posts/${id}/reject`, { token: admin, body: { content_version: 1, reason } })).status, 400)
    }
    assert.equal((await approve('invalid', 1)).status, 400)
    assert.equal((await state(id)).status, 'pending')
  })
  await test('预览后编辑使旧版本失效；新版本审核快照与通知原子保存', async () => {
    const id = await mkPost(author, { status: 'pending' })
    const old = (await review(id)).data.data
    const update = await http('PUT', `/posts/${id}`, { token, body: { content_version: 1, title: '修订内容', content: '<p>完整新版正文</p>', tags: ['审核版本测试'] } })
    assert.equal(update.status, 200)
    assert.equal((await approve(id, old.content_version)).status, 409)
    assert.equal((await state(id)).status, 'pending')
    const next = (await review(id)).data.data
    assert.equal(next.content_version, 2)
    assert.equal(next.tags[0], '审核版本测试')
    assert.equal((await approve(id, next.content_version)).status, 200)
    const [events] = await pool.execute('SELECT * FROM post_reviews WHERE post_id=?', [id])
    assert.equal(events.length, 1)
    const snapshot = typeof events[0].snapshot === 'string' ? JSON.parse(events[0].snapshot) : events[0].snapshot
    assert.equal(snapshot.content, '<p>完整新版正文</p>')
    assert.equal(snapshot.content_version, 2)
    assert.equal((await review(id)).data.data.reviews.length, 1)
  })
  await test('同时通过与驳回只产生一个结果、一条审核记录和一条通知', async () => {
    const id = await mkPost(author, { status: 'pending' })
    const r = await Promise.all([approve(id, 1), http('PUT', `/admin/posts/${id}/reject`, { token: admin, body: { content_version: 1, reason: '补充步骤' } })])
    assert.deepEqual(r.map(x => x.status).sort(), [200, 409])
    assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM post_reviews WHERE post_id=?', [id]))[0][0].n, 1)
    assert.equal((await pool.execute("SELECT COUNT(*) AS n FROM notifications WHERE type='audit' AND target_id=?", [id]))[0][0].n, 1)
  })
  await test('作者编辑与审核并发：任何顺序都不能让未审新版保持公开', async () => {
    for (let i = 0; i < 5; i++) {
      const id = await mkPost(author, { status: 'pending' })
      const results = await Promise.all([
        approve(id, 1),
        http('PUT', `/posts/${id}`, { token, body: { content_version: 1, content: '<p>尚未审阅的新内容</p>' } }),
      ])
      assert.ok([200, 409].includes(results[0].status))
      assert.equal(results[1].status, 200)
      const p = await state(id)
      assert.ok(['pending','published'].includes(p.status))
      assert.equal(p.content_version, 2)
      const visible = await http('GET', `/posts/${id}`)
      if (p.status === 'published') {
        assert.equal(visible.status, 200)
        assert.notEqual(visible.data.data.content, '<p>尚未审阅的新内容</p>')
        assert.equal((await review(id)).data.data.status, 'pending')
      } else assert.equal(visible.status, 404)
    }
  })
  await test('已发布文章保存返回真实待审状态，首次发布时间保留', async () => {
    const id = await mkPost(author, { status: 'pending' })
    assert.equal((await approve(id, 1)).status, 200)
    const first = await state(id)
    const r = await http('PUT', `/posts/${id}`, { token, body: { content_version: 1, title: '发布后修订' } })
    assert.equal(r.data.data.status, 'pending')
    assert.ok((await review(id)).data.data.submitted_at)
    assert.equal((await state(id)).status, 'published')
    assert.equal((await approve(id, 2)).status, 200)
    assert.equal(String((await state(id)).published_at), String(first.published_at))
  })
  await test('驳回重提递增版本，历史原因保留；重复提交被拒绝', async () => {
    const id = await mkPost(author, { status: 'pending' })
    await http('PUT', `/admin/posts/${id}/reject`, { token: admin, body: { content_version: 1, reason: '补充图片说明' } })
    const r = await Promise.all([http('POST', `/posts/${id}/submit`, { token }), http('POST', `/posts/${id}/submit`, { token })])
    assert.equal(r.filter(x => x.status === 200).length, 1)
    assert.ok(r.every(x => [200,400,409].includes(x.status)))
    const current = (await review(id)).data.data
    assert.equal(current.content_version, 2)
    assert.equal(current.reject_reason, null)
    assert.equal(current.reviews[0].reason, '补充图片说明')
  })
  await test('通知写入失败时审核状态与审核记录一起回滚', async () => {
    const id = await mkPost(author, { status: 'pending' })
    // 仅在本轮独立测试库注入失败，finally 删除触发器。
    await pool.query(`CREATE TRIGGER test_review_notification_failure BEFORE INSERT ON notifications FOR EACH ROW
      BEGIN IF NEW.target_id=${id} AND NEW.type='audit' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test review rollback'; END IF; END`)
    try {
      assert.equal((await approve(id, 1)).status, 500)
      assert.equal((await state(id)).status, 'pending')
      assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM post_reviews WHERE post_id=?', [id]))[0][0].n, 0)
    } finally { await pool.query('DROP TRIGGER test_review_notification_failure') }
  })
}
