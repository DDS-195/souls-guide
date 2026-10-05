// 09 创作者统计 v2：发布时间、事件事实、有效阅读去重、净增、过滤、日聚合与权限
const H = require('./helpers')

module.exports = async function analyticsSuite() {
  console.log('\n[09] 创作者统计 v2 /api/creator/stats')
  const { test, http, mkUser, mkPost, makeToken, adminToken, pool, SEQ } = H
  const authorId = await mkUser('sauthor', { role: 'creator', apply: 'approved' })
  const readerId = await mkUser('sreader')
  const plainId = await mkUser('splain')
  const authorTok = makeToken(authorId, 'sauthor', 'creator')
  const readerTok = makeToken(readerId, 'sreader', 'user')
  const plainTok = makeToken(plainId, 'splain', 'user')
  const postId = await mkPost(authorId, { status: 'published', title: `统计文章_${SEQ}`, category: '剧情解析' })

  await test('权限与查询参数校验', async () => {
    H.assert.equal((await http('GET', '/creator/stats')).status, 401)
    H.assert.equal((await http('GET', '/creator/stats', { token: plainTok })).status, 403)
    H.assert.equal((await http('GET', '/creator/stats?from=2024-01-01&to=2026-01-01', { token: authorTok })).status, 400)
    H.assert.equal((await http('GET', '/creator/stats?category=不存在', { token: authorTok })).status, 400)
    H.assert.equal((await http('GET', '/creator/stats?rank_by=score', { token: authorTok })).status, 400)
  })

  await test('审核通过只写首次 published_at', async () => {
    const pending = await mkPost(authorId, { status: 'pending', title: `待审_${SEQ}` })
    const adminTok = await adminToken()
    H.assert.equal((await http('PUT', `/admin/posts/${pending}/approve`, { token: adminTok, body: { content_version: 1 } })).status, 200)
    const [[first]] = await pool.execute('SELECT published_at FROM posts WHERE id=?', [pending])
    H.assert.ok(first.published_at)
    await http('PUT', `/posts/${pending}`, { token: authorTok, body: { content_version: 1, title: `修订_${SEQ}` } })
    H.assert.equal((await http('PUT', `/admin/posts/${pending}/approve`, { token: adminTok, body: { content_version: 2 } })).status, 200)
    const [[second]] = await pool.execute('SELECT published_at FROM posts WHERE id=?', [pending])
    H.assert.equal(+new Date(second.published_at), +new Date(first.published_at))
  })

  await test('有效阅读：详情 GET 不计数、访客会话去重、作者本人不计数', async () => {
    const [[before]] = await pool.execute('SELECT view_count FROM posts WHERE id=?', [postId])
    await http('GET', `/posts/${postId}`)
    const [[afterGet]] = await pool.execute('SELECT view_count FROM posts WHERE id=?', [postId])
    H.assert.equal(afterGet.view_count, before.view_count)
    const visitor = `analytics_visitor_${SEQ}`
    const first = await http('POST', `/posts/${postId}/view`, { body: { visitor_id: visitor } })
    const repeated = await http('POST', `/posts/${postId}/view`, { body: { visitor_id: visitor } })
    const self = await http('POST', `/posts/${postId}/view`, { token: authorTok, body: { visitor_id: `self_${SEQ}_visitor` } })
    H.assert.equal(first.data.data.counted, true)
    H.assert.equal(repeated.data.data.counted, false)
    H.assert.equal(self.data.data.counted, false)
    H.assert.equal((await http('POST', `/posts/${postId}/view`, { body: { visitor_id: 'short' } })).status, 400)
  })

  await test('互动新增/取消进入不可变事件并得到正确净增', async () => {
    await http('POST', `/posts/${postId}/like`, { token: readerTok })
    await http('POST', `/posts/${postId}/like`, { token: readerTok })
    await http('POST', `/posts/${postId}/favorite`, { token: readerTok })
    await http('POST', `/posts/${postId}/favorite`, { token: readerTok })
    const comment = await http('POST', `/posts/${postId}/comments`, { token: readerTok, body: { content: '统计评论' } })
    await http('DELETE', `/comments/${comment.data.data.id}`, { token: readerTok })
    await http('POST', `/follows/${authorId}`, { token: readerTok })
    await http('POST', `/follows/${authorId}`, { token: readerTok })

    const data = (await http('GET', '/creator/stats', { token: authorTok })).data.data
    H.assert.equal(data.period.pv, 1)
    H.assert.equal(data.period.uv, 1)
    H.assert.equal(data.period.likes_added, 1)
    H.assert.equal(data.period.likes_removed, 1)
    H.assert.equal(data.period.likes_net, 0)
    H.assert.equal(data.period.favorites_net, 0)
    H.assert.equal(data.period.comments_net, 0)
    H.assert.equal(data.period.followers_net, 0)
    H.assert.equal(data.current.active_likes, 0)
    H.assert.equal(data.current.active_favorites, 0)
    H.assert.equal(data.current.active_comments, 0)
    H.assert.equal(data.current.followers, 0)
    H.assert.equal(data.meta.timezone, 'Asia/Shanghai')
    H.assert.equal(data.meta.definitions_version, '2.1')
    H.assert.equal(data.trend.length, 30)
    H.assert.ok(data.trend.every((row, index, rows) => index === 0 || rows[index - 1].date < row.date))
  })

  await test('创作者本人互动有事件审计但不进入业务指标', async () => {
    await http('POST', `/posts/${postId}/like`, { token: authorTok })
    const data = (await http('GET', '/creator/stats', { token: authorTok })).data.data
    H.assert.equal(data.period.likes_added, 1, '仅包含读者的历史新增，作者本人点赞不增加')
    H.assert.equal(data.current.active_likes, 0, '当前有效状态排除作者本人')
    const [[event]] = await pool.execute(
      "SELECT is_internal FROM analytics_events WHERE event_type='like' AND post_id=? AND actor_id=? ORDER BY id DESC LIMIT 1",
      [postId, authorId]
    )
    H.assert.equal(event.is_internal, 1)
  })

  await test('日聚合与事实事件一致，分类筛选和 Top 排行结构完整', async () => {
    const [[daily]] = await pool.execute(
      "SELECT pv,uv,likes_added,likes_removed FROM analytics_daily_metrics WHERE scope_type='post' AND scope_id=? AND metric_date=CURDATE()",
      [postId]
    )
    H.assert.equal(daily.pv, 1)
    H.assert.equal(daily.uv, 1)
    H.assert.equal(daily.likes_added, 1)
    H.assert.equal(daily.likes_removed, 1)
    const response = await http('GET', `/creator/stats?category=${encodeURIComponent('剧情解析')}&rank_by=engagement_rate`, { token: authorTok })
    H.assert.equal(response.status, 200)
    H.assert.ok(response.data.data.top_posts.some((post) => post.id === postId))
    H.assert.ok(response.data.data.category_performance.every((item) => item.category === '剧情解析'))
    H.assert.equal(response.data.data.meta.filters.rank_by, 'engagement_rate')
  })

  // 不同操作者删除同样的混合子树时，有效统计始终按原评论身份，而非操作身份。
  async function deleteMixedTree(rootToken, replyToken, deletionToken, deletionActorId) {
    const id = await mkPost(authorId, { status: 'published', title: `混合评论统计_${SEQ}` })
    const root = await http('POST', `/posts/${id}/comments`, { token: rootToken, body: { content: '根评论' } })
    H.assert.equal(root.status, 200)
    const rootId = root.data.data.id
    H.assert.equal((await http('POST', `/comments/${rootId}/reply`, { token: replyToken, body: { content: '回复' } })).status, 200)
    await pool.execute("INSERT INTO comments (post_id,user_id,parent_id,content,is_deleted) VALUES (?,NULL,?,'[该评论已删除]',1)", [id, rootId])
    const deleted = await http('DELETE', `/comments/${rootId}`, { token: deletionToken })
    H.assert.equal(deleted.status, 200)
    H.assert.equal(deleted.data.data.comment_count, 0)
    const [[events]] = await pool.execute(`SELECT
      SUM(CASE WHEN is_internal=0 THEN event_value ELSE 0 END) AS effective,
      SUM(CASE WHEN is_internal=1 THEN event_value ELSE 0 END) AS excluded,
      COUNT(DISTINCT actor_id) AS actors,MIN(actor_id) AS actor
      FROM analytics_events WHERE post_id=? AND event_type='comment_delete'`, [id])
    H.assert.equal(Number(events.effective), 1, '只有读者的原评论/回复计为有效删除')
    H.assert.equal(Number(events.excluded), 2, '作者自身评论与已删除占位节点仅保留审计')
    H.assert.equal(Number(events.actors), 1)
    H.assert.equal(events.actor, deletionActorId, '事件操作者仍是实际执行删除的账号')
    const [[daily]] = await pool.execute("SELECT comments_added,comments_removed FROM analytics_daily_metrics WHERE scope_type='post' AND scope_id=? AND metric_date=CURDATE()", [id])
    H.assert.equal(daily.comments_added, 1)
    H.assert.equal(daily.comments_removed, 1)
    const stats = (await http('GET', `/creator/stats?post_id=${id}`, { token: authorTok })).data.data
    H.assert.equal(stats.period.comments_added, 1)
    H.assert.equal(stats.period.comments_removed, 1)
    H.assert.equal(stats.period.comments_net, 0)
    H.assert.equal(stats.current.active_comments, 0)
  }

  await test('作者删除自己的根评论和读者回复：不能把有效删除视为作者内部操作', async () => {
    await deleteMixedTree(authorTok, readerTok, authorTok, authorId)
  })
  await test('读者删除自己的根评论和作者回复：不能把作者回复/占位记为有效删除', async () => {
    await deleteMixedTree(readerTok, authorTok, readerTok, readerId)
  })
  await test('管理员删除混合评论子树：有效数量正确并保留管理员操作身份', async () => {
    const token = await adminToken()
    const [[admin]] = await pool.execute("SELECT id FROM users WHERE username='admin'")
    await deleteMixedTree(readerTok, authorTok, token, admin.id)
  })
}
