// 03 文章模块：列表过滤/详情/创建校验/编辑重审/删除磁盘清理/submit 状态机/my-list/评论树/点赞收藏关注
const H = require('./helpers')

module.exports = async function postsSuite() {
  console.log('\n[03] 文章模块 /api/posts')
  const { test, http, mkUser, mkPost, makeToken, adminToken, pool, created, trackFile, expectFile, urlToAbs, SEQ } = H
  let adminTok = ''
  await adminToken().then(t => adminTok = t)

  // 基础用户：作者 A（creator）、读者 B（user）、外人 C（creator）
  const authorId = await mkUser('pauthor', { role: 'creator', apply: 'approved' })
  const readerId = await mkUser('preader')
  const otherId = await mkUser('pother', { role: 'creator', apply: 'approved' })
  const authorTok = makeToken(authorId, 'pauthor', 'creator')
  const readerTok = makeToken(readerId, 'preader', 'user')
  const otherTok = makeToken(otherId, 'pother', 'creator')

  // ---- 列表 ----
  let postId = null
  await test('GET /posts → 200 分页信封 + JOIN 字段', async () => {
    const r = await http('GET', '/posts', { query: '' })
    H.assert.equal(r.status, 200)
    const d = r.data.data
    H.assert.ok('total' in d && 'page' in d && 'pageSize' in d && Array.isArray(d.list))
  })
  await test('创建 published 文章后列表可见且含 game_name/username/avatar/tags', async () => {
    const c = await http('POST', '/posts', { token: authorTok, body: { title: `测试攻略_${SEQ}`, content: '<p>正文</p>', game_id: 1, category: 'BOSS攻略', tags: ['无伤', '近战'] } })
    H.assert.equal(c.status, 200)
    postId = c.data.data.id
    created.posts.push(postId)
    await pool.execute("UPDATE posts SET status='published' WHERE id=?", [postId])
    const r = await http('GET', '/posts', {})
    const hit = r.data.data.list.find(p => p.id === postId)
    H.assert.ok(hit, '列表应包含新文章')
    H.assert.equal(hit.game_name, '艾尔登法环')
    H.assert.equal(hit.username, `pauthor_${SEQ}`)
    H.assert.ok(Array.isArray(hit.avatar) || hit.avatar === null || typeof hit.avatar === 'string')
    H.assert.deepEqual([...hit.tags].sort(), ['无伤', '近战'].sort())
  })
  await test('game_id/category/keyword/user_id/ids 过滤生效', async () => {
    const byGame = await http('GET', `/posts?game_id=1`)
    H.assert.ok(byGame.data.data.list.every(p => p.game_id === 1))
    const byCat = await http('GET', `/posts?category=${encodeURIComponent('BOSS攻略')}`)
    H.assert.ok(byCat.data.data.list.every(p => p.category === 'BOSS攻略'))
    const byKw = await http('GET', `/posts?keyword=${encodeURIComponent(`测试攻略_${SEQ}`)}`)
    H.assert.ok(byKw.data.data.list.some(p => p.id === postId))
    const byUser = await http('GET', `/posts?user_id=${authorId}`)
    H.assert.ok(byUser.data.data.list.every(p => p.user_id === authorId))
    const byIds = await http('GET', `/posts?ids=${postId}`)
    H.assert.equal(byIds.data.data.list.length, 1)
    H.assert.equal(byIds.data.data.list[0].id, postId)
  })
  await test('ids 非法输入 → 空列表不退化（D23 防注入）', async () => {
    const r = await http('GET', '/posts?ids=abc,1.5,99999999')
    H.assert.equal(r.status, 200)
    H.assert.equal(r.data.data.list.length, 0)
  })
  await test('sort=hot 按浏览量倒序', async () => {
    const r = await http('GET', '/posts?sort=hot')
    const v = r.data.data.list.map(p => p.view_count)
    H.assert.ok(v.every((x, i) => i === 0 || v[i - 1] >= x), '应按 view_count DESC')
  })

  // ---- 详情 ----
  await test('GET /:id → 200 含 tags/media 且 view_count+1', async () => {
    const before = (await http('GET', `/posts/${postId}`)).data.data.view_count
    const r = await http('GET', `/posts/${postId}`)
    H.assert.equal(r.status, 200)
    H.assert.equal(r.data.data.view_count, before + 1)
    H.assert.ok(Array.isArray(r.data.data.tags) && Array.isArray(r.data.data.media))
  })
  await test('draft 文章详情 → 404（可见性契约）', async () => {
    const pid = await mkPost(authorId, { status: 'draft' })
    const r = await http('GET', `/posts/${pid}`)
    H.assert.equal(r.status, 404)
  })

  // ---- 创建校验（P1-1/P1-2）----
  await test('POST /posts 无 token → 401 / 普通用户 → 403', async () => {
    H.assert.equal((await http('POST', '/posts', { body: {} })).status, 401)
    H.assert.equal((await http('POST', '/posts', { token: readerTok, body: {} })).status, 403)
  })
  await test('缺字段 → 400', async () => {
    const r = await http('POST', '/posts', { token: authorTok, body: { title: 'x' } })
    H.assert.equal(r.status, 400)
  })
  await test('game_id 不存在 → 400（P1-2 修复：原外键 500）', async () => {
    const r = await http('POST', '/posts', { token: authorTok, body: { title: 'x', content: '<p>x</p>', game_id: 999999, category: 'BOSS攻略' } })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '游戏不存在')
  })
  await test('非法分类 → 400（白名单）', async () => {
    const r = await http('POST', '/posts', { token: authorTok, body: { title: 'x', content: '<p>x</p>', game_id: 1, category: '非法分类' } })
    H.assert.equal(r.status, 400)
  })
  await test('标题超 200 字 → 400（P1-1 修复）', async () => {
    const r = await http('POST', '/posts', { token: authorTok, body: { title: 'x'.repeat(201), content: '<p>x</p>', game_id: 1, category: 'BOSS攻略' } })
    H.assert.equal(r.status, 400)
  })
  await test('video 非 /uploads 前缀 → 400', async () => {
    const r = await http('POST', '/posts', { token: authorTok, body: { title: 'x', content: '<p>x</p>', game_id: 1, category: 'BOSS攻略', video: 'http://evil.com/a.mp4' } })
    H.assert.equal(r.status, 400)
  })
  await test('请求体 status 字段被忽略（防越权直发）', async () => {
    const r = await http('POST', '/posts', { token: authorTok, body: { title: `越权_${SEQ}`, content: '<p>x</p>', game_id: 1, category: 'BOSS攻略', status: 'published' } })
    H.assert.equal(r.status, 200)
    created.posts.push(r.data.data.id)
    const [[p]] = await pool.execute('SELECT status FROM posts WHERE id=?', [r.data.data.id])
    H.assert.equal(p.status, 'draft')
  })

  // ---- 视频 media 写入（D13）----
  await test('带 video 参数创建 → media 表写入 type=video', async () => {
    const r = await http('POST', '/posts', { token: authorTok, body: { title: `视频文_${SEQ}`, content: '<p><img src="/uploads/images/2026/08/mock.jpg" alt="p"></p>', game_id: 1, category: 'BOSS攻略', video: '/uploads/videos/2026/08/mock.mp4' } })
    H.assert.equal(r.status, 200)
    created.posts.push(r.data.data.id)
    const [media] = await pool.execute('SELECT type, sort_order FROM media WHERE post_id=? ORDER BY sort_order', [r.data.data.id])
    H.assert.equal(media.length, 2)
    H.assert.equal(media[0].type, 'video')
    H.assert.equal(media[0].sort_order, 0)
    H.assert.equal(media[1].type, 'image')
    H.assert.equal(media[1].sort_order, 1)
  })

  // ---- 编辑 ----
  await test('PUT 编辑本人 → 200；他人 → 403', async () => {
    const ok = await http('PUT', `/posts/${postId}`, { token: authorTok, body: { title: '改标题' } })
    H.assert.equal(ok.status, 200)
    const deny = await http('PUT', `/posts/${postId}`, { token: otherTok, body: { title: '抢' } })
    H.assert.equal(deny.status, 403)
    const adm = await http('PUT', `/posts/${postId}`, { token: adminTok, body: { title: '管理员改' } })
    H.assert.equal(adm.status, 200)
  })
  await test('编辑 published → 自动重置 pending（P1-7 修复）', async () => {
    const pubX = await mkPost(authorId, { status: 'published' })
    const r = await http('PUT', `/posts/${pubX}`, { token: authorTok, body: { title: '触发重审' } })
    H.assert.equal(r.status, 200)
    const [[p]] = await pool.execute('SELECT status FROM posts WHERE id=?', [pubX])
    H.assert.equal(p.status, 'pending')
  })
  await test('编辑不带 video 字段 → 视频 media 保留（P2-6 修复）', async () => {
    const pid = await mkPost(authorId, { status: 'draft', video: '/uploads/videos/2026/08/keep.mp4', content: '<p>x</p>' })
    await pool.execute("INSERT INTO media (post_id, url, type, sort_order) VALUES (?,?,?,?)", [pid, '/uploads/videos/2026/08/keep.mp4', 'video', 0])
    const r = await http('PUT', `/posts/${pid}`, { token: authorTok, body: { content: '<p>只改正文</p>' } })
    H.assert.equal(r.status, 200)
    const [media] = await pool.execute("SELECT url FROM media WHERE post_id=? AND type='video'", [pid])
    H.assert.equal(media.length, 1)
    H.assert.equal(media[0].url, '/uploads/videos/2026/08/keep.mp4')
  })

  // ---- 删除 + 磁盘清理（P2-5）----
  await test('DELETE 他人 → 403', async () => {
    const pid = await mkPost(authorId, { status: 'draft' })
    const r = await http('DELETE', `/posts/${pid}`, { token: otherTok })
    H.assert.equal(r.status, 403)
  })
  await test('删除文章清理磁盘文件（P2-5 修复）', async () => {
    // 真实上传两张图：一张内嵌 content，一张做封面
    const up1 = await http('POST', '/media/upload/image', { token: authorTok, form: H.pngForm('inner.png') })
    const up2 = await http('POST', '/media/upload/image', { token: authorTok, form: H.pngForm('cover.png') })
    H.assert.equal(up1.status, 200); H.assert.equal(up2.status, 200)
    const imgUrl = trackFile(up1.data.data.url)
    const coverUrl = trackFile(up2.data.data.url)
    expectFile(imgUrl, true); expectFile(coverUrl, true)
    const c = await http('POST', '/posts', { token: authorTok, body: { title: `磁盘清理_${SEQ}`, content: `<p><img src="${imgUrl}" alt="i"></p>`, cover: coverUrl, game_id: 1, category: 'BOSS攻略' } })
    H.assert.equal(c.status, 200)
    created.posts.push(c.data.data.id)
    const del = await http('DELETE', `/posts/${c.data.data.id}`, { token: authorTok })
    H.assert.equal(del.status, 200)
    const [[m]] = await pool.execute('SELECT COUNT(*) c FROM media WHERE post_id=?', [c.data.data.id])
    H.assert.equal(m.c, 0, 'media 行应级联删除')
    expectFile(imgUrl, false)
    expectFile(coverUrl, false)
  })

  // ---- submit 状态机（P1-8）----
  await test('draft submit → pending；published submit → 400（P1-8 修复）', async () => {
    const draftId = await mkPost(authorId, { status: 'draft' })
    H.assert.equal((await http('POST', `/posts/${draftId}/submit`, { token: authorTok })).status, 200)
    const [[d]] = await pool.execute('SELECT status FROM posts WHERE id=?', [draftId])
    H.assert.equal(d.status, 'pending')
    const pubId = await mkPost(authorId, { status: 'published' })
    const r = await http('POST', `/posts/${pubId}/submit`, { token: authorTok })
    H.assert.equal(r.status, 400)
  })
  await test('rejected 可重新提交', async () => {
    const rid = await mkPost(authorId, { status: 'rejected' })
    H.assert.equal((await http('POST', `/posts/${rid}/submit`, { token: authorTok })).status, 200)
    const [[p]] = await pool.execute('SELECT status FROM posts WHERE id=?', [rid])
    H.assert.equal(p.status, 'pending')
  })

  // ---- my/list（方案 A 回填契约）----
  await test('GET /my/list → 200 全状态 + tags + media(video)', async () => {
    const mineId = await mkPost(authorId, { status: 'draft', video: '/uploads/videos/2026/08/mine.mp4' })
    await pool.execute("INSERT INTO media (post_id, url, type, sort_order) VALUES (?, '/uploads/videos/2026/08/mine.mp4', 'video', 0)", [mineId])
    const r = await http('GET', '/posts/my/list', { token: authorTok })
    H.assert.equal(r.status, 200)
    const d = r.data.data
    H.assert.ok(d.total >= 1)
    H.assert.ok(d.list.every(p => Array.isArray(p.tags)))
    H.assert.ok(d.list.some(p => Array.isArray(p.media) && p.media.some(m => m.type === 'video')))
  })

  // ---- 评论（P0-3/P1-5）----
  let rootCid = null
  await test('发表评论 → 200 且 comment_count+1', async () => {
    const before = (await pool.execute('SELECT comment_count FROM posts WHERE id=?', [postId]))[0][0].comment_count
    const r = await http('POST', `/posts/${postId}/comments`, { token: readerTok, body: { content: '好攻略！' } })
    H.assert.equal(r.status, 200)
    rootCid = r.data.data.id
    const after = (await pool.execute('SELECT comment_count FROM posts WHERE id=?', [postId]))[0][0].comment_count
    H.assert.equal(after, before + 1)
  })
  await test('空评论 → 400；超 2000 字 → 400（P1-1 修复）', async () => {
    H.assert.equal((await http('POST', `/posts/${postId}/comments`, { token: readerTok, body: { content: '' } })).status, 400)
    H.assert.equal((await http('POST', `/posts/${postId}/comments`, { token: readerTok, body: { content: 'x'.repeat(2001) } })).status, 400)
  })
  await test('parent_id 不存在 → 404；跨文章 → 400（P1-5 修复）', async () => {
    const r1 = await http('POST', `/posts/${postId}/comments`, { token: readerTok, body: { content: 'x', parent_id: 99999999 } })
    H.assert.equal(r1.status, 404)
    const otherPost = await mkPost(authorId, { status: 'published' })
    const cid = (await http('POST', `/posts/${postId}/comments`, { token: readerTok, body: { content: 'root2' } })).data.data.id
    const r2 = await http('POST', `/posts/${otherPost}/comments`, { token: readerTok, body: { content: 'x', parent_id: cid } })
    H.assert.equal(r2.status, 400)
    H.assert.equal(r2.data.message, '回复的评论不属于该文章')
  })
  await test('回复评论 → 200 且嵌套树正确', async () => {
    const r = await http('POST', '/comments/' + rootCid + '/reply', { token: readerTok, body: { content: '回复一楼' } })
    H.assert.equal(r.status, 200)
    const c = await http('GET', `/posts/${postId}/comments`)
    const root = c.data.data.find(x => x.id === rootCid)
    H.assert.ok(root.replies.some(x => x.content === '回复一楼'))
  })
  await test('删除他人评论 → 403', async () => {
    const r = await http('DELETE', `/comments/${rootCid}`, { token: otherTok })
    H.assert.equal(r.status, 403)
  })
  await test('删父评论（含回复）计数重算（P0-3 修复）', async () => {
    const before = (await pool.execute('SELECT comment_count FROM posts WHERE id=?', [postId]))[0][0].comment_count
    const del = await http('DELETE', `/comments/${rootCid}`, { token: readerTok })
    H.assert.equal(del.status, 200)
    const after = (await pool.execute('SELECT comment_count FROM posts WHERE id=?', [postId]))[0][0].comment_count
    // 根评论 + 1 条回复 = 2 条被删，计数应减 2（旧实现只减 1）
    H.assert.equal(after, before - 2, `before=${before} after=${after}`)
    const [rows] = await pool.execute('SELECT COUNT(*) c FROM comments WHERE post_id=?', [postId])
    H.assert.equal(rows[0].c, after, '计数与真实行数一致')
  })

  // ---- 点赞/收藏/关注（P0-2）----
  await test('点赞 toggle true→false；快速双击两次均 200（P0-2 修复）', async () => {
    const pub2 = await mkPost(authorId, { status: 'published' })
    const first = await http('POST', `/posts/${pub2}/like`, { token: readerTok })
    H.assert.equal(first.status, 200)
    H.assert.equal(first.data.data.liked, true)
    const second = await http('POST', `/posts/${pub2}/like`, { token: readerTok })
    H.assert.equal(second.status, 200)
    H.assert.equal(second.data.data.liked, false)
    const [[p]] = await pool.execute('SELECT like_count FROM posts WHERE id=?', [pub2])
    H.assert.equal(p.like_count, 0, '计数应复原')
  })
  await test('收藏 toggle true→false', async () => {
    const pub3 = await mkPost(authorId, { status: 'published' })
    H.assert.equal((await http('POST', `/posts/${pub3}/favorite`, { token: readerTok })).data.data.favorited, true)
    H.assert.equal((await http('POST', `/posts/${pub3}/favorite`, { token: readerTok })).data.data.favorited, false)
  })
  await test('关注 toggle；关注自己 → 400；不存在 → 404', async () => {
    H.assert.equal((await http('POST', `/follows/${authorId}`, { token: readerTok })).data.data.following, true)
    H.assert.equal((await http('POST', `/follows/${authorId}`, { token: readerTok })).data.data.following, false)
    H.assert.equal((await http('POST', `/follows/${readerId}`, { token: readerTok })).status, 400)
    H.assert.equal((await http('POST', '/follows/99999999', { token: readerTok })).status, 404)
  })
  await test('GET /:id/status → liked/favorited/is_followed', async () => {
    const pub4 = await mkPost(authorId, { status: 'published' })
    await http('POST', `/posts/${pub4}/like`, { token: readerTok })
    await http('POST', `/posts/${pub4}/favorite`, { token: readerTok })
    await http('POST', `/follows/${authorId}`, { token: readerTok })
    const r = await http('GET', `/posts/${pub4}/status`, { token: readerTok })
    H.assert.equal(r.status, 200)
    H.assert.equal(r.data.data.liked, true)
    H.assert.equal(r.data.data.favorited, true)
    H.assert.equal(r.data.data.is_followed, true)
  })
  await test('互动触发作者通知（4.3 规则）', async () => {
    const pub5 = await mkPost(authorId, { status: 'published' })
    await http('POST', `/posts/${pub5}/like`, { token: readerTok })
    await http('POST', `/posts/${pub5}/comments`, { token: readerTok, body: { content: '评论触发通知' } })
    const n = await http('GET', '/notifications', { token: authorTok })
    const list = n.data.data.list
    H.assert.ok(list.some(x => x.type === 'like' && x.target_id === pub5), '点赞通知')
    H.assert.ok(list.some(x => x.type === 'comment' && x.target_id === pub5), '评论通知')
  })
}
