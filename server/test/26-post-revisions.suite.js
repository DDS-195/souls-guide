const H = require('./helpers')
const assets = require('../src/services/assetService')
const cleanup = require('../src/services/cleanupService')
const fs = require('fs/promises')
const crypto = require('crypto')

module.exports = async function () {
  const { test, assert, http, pool, mkUser, mkPost, makeToken } = H
  const owner = await mkUser('revision_author', { role: 'creator', apply: 'approved' })
  const reader = await mkUser('revision_reader')
  const other = await mkUser('revision_other', { role: 'creator' })
  const token = makeToken(owner, 'revision_author', 'creator')
  const readerToken = makeToken(reader, 'revision_reader', 'user')
  const admin = await H.adminToken()
  const manage = async id => (await http('GET', `/posts/manage/${id}`, { token })).data.data
  const publicPost = async id => (await http('GET', `/posts/${id}`)).data.data
  const edit = (id, version, body = {}) => http('PUT', `/posts/${id}`, { token, body: { content_version: version, ...body } })
  const decide = (id, version, approve = true) => http('PUT', `/admin/posts/${id}/${approve ? 'approve' : 'reject'}`, {
    token: admin, body: { content_version: version, ...(approve ? {} : { reason: '补充操作说明' }) },
  })
  const image = async () => {
    const r = await http('POST', '/media/upload/image', { token, form: H.pngForm('revision.png') })
    assert.equal(r.status, 200)
    H.trackFile(r.data.data.url)
    return r.data.data.url
  }
  const video = async () => {
    const url = `/uploads/videos/revision-${crypto.randomBytes(6).toString('hex')}.mp4`
    H.trackFile(url)
    const file = H.urlToAbs(url)
    await fs.mkdir(require('path').dirname(file), { recursive: true })
    await fs.writeFile(file, '0123456789')
    await assets.registerUpload(owner, { url, type: 'video' })
    return url
  }
  const oldCover = await image(), newCover = await image(), newVideo = await video()
  const id = await mkPost(owner, { title: '公开旧版', content: '<p>旧内容</p>', cover: oldCover })
  await assets.replacePostAssets(id, owner, [{ url: oldCover, usage_type: 'cover' }])
  await require('../src/services/postService').setTags(id, ['旧标签'])
  await http('POST', `/posts/${id}/like`, { token: readerToken })
  await http('POST', `/posts/${id}/favorite`, { token: readerToken })
  await http('POST', `/posts/${id}/comments`, { token: readerToken, body: { content: '保留评论' } })
  await http('POST', `/follows/${owner}`, { token: readerToken })
  const original = await publicPost(id)
  const revised = { title: '修订标题', content: `<p>新内容<img src="${newCover}"></p>`, cover: newCover,
    video: newVideo, game_id: 2, category: '新手入门', tags: ['新标签'] }

  await test('修订期间公开正文/封面/标签/游戏和互动不变，作者读取修订', async () => {
    const r = await edit(id, 1, revised)
    assert.equal(r.status, 200); assert.equal(r.data.data.public_status, 'published')
    const visible = await publicPost(id), draft = await manage(id)
    for (const field of ['title','content','cover','game_id','category','published_at','updated_at','like_count','comment_count','favorite_count']) assert.deepEqual(visible[field], original[field], field)
    assert.deepEqual(visible.tags, ['旧标签']); assert.equal(visible.media.length, 0)
    assert.equal(draft.title, revised.title); assert.equal(draft.status, 'pending'); assert.equal(draft.is_revision, true)
    assert.equal(draft.content_version, 2); assert.ok(draft.media.some(m => m.url === newVideo))
    const my = (await http('GET', '/posts/my/list?pageSize=50', { token })).data.data.list.find(p => p.id === id)
    assert.equal(my.title, revised.title); assert.equal(my.public_status, 'published')
    for (const path of ['/favorites','/following-feed']) {
      const found = (await http('GET', path, { token: readerToken })).data.data.list.find(p => p.id === id)
      assert.equal(found.title, original.title); assert.equal(found.game_id, 1); assert.equal(found.has_video, false)
    }
    assert.equal((await http('GET', `/posts/${id}/status`, { token: readerToken })).status, 200)
    assert.equal((await http('GET', `/posts/${id}/comments`)).data.data.total, 1)
    assert.equal((await http('GET', `/posts?game_id=1&ids=${id}`)).data.data.total, 1)
    assert.equal((await http('GET', `/posts?game_id=2&ids=${id}`)).data.data.total, 0)
  })
  await test('审核队列/快照展示新版且权限隔离；新图片与视频不公开', async () => {
    const queue = (await http('GET', '/admin/posts/pending?pageSize=50', { token: admin })).data.data.list.find(p => p.id === id)
    assert.ok(queue); assert.equal(queue.title, revised.title); assert.equal(queue.game_id, 2)
    assert.ok(queue.is_revision); assert.ok(!('content' in queue))
    const snapshot = (await http('GET', `/admin/posts/${id}/review`, { token: admin })).data.data
    assert.equal(snapshot.content, revised.content); assert.equal(snapshot.game_name, (await pool.execute('SELECT name FROM games WHERE id=2'))[0][0].name)
    assert.equal((await http('GET', `/posts/manage/${id}`, { token: makeToken(other,'other','creator') })).status, 403)
    const grant = (await http('GET', '/users/me', { token })).headers['x-media-grant']
    for (const url of [newCover,newVideo]) {
      assert.equal((await fetch('http://127.0.0.1:3199' + url)).status, 404)
      const r = await fetch('http://127.0.0.1:3199' + url, { headers: { Cookie: 'sg_media=' + grant, ...(url === newVideo ? { Range: 'bytes=2-5' } : {}) } })
      assert.equal(r.status, url === newVideo ? 206 : 200)
    }
    assert.equal((await fetch('http://127.0.0.1:3199' + oldCover)).status, 200)
  })
  await test('驳回只改变修订；重新提交递增版本，拒绝过期审核', async () => {
    assert.equal((await decide(id, 2, false)).status, 200)
    assert.equal((await publicPost(id)).title, original.title)
    const draft = await manage(id)
    assert.equal(draft.status, 'rejected'); assert.equal(draft.public_status, 'published')
    assert.equal(draft.reject_reason, '补充操作说明')
    assert.equal((await http('POST', `/posts/${id}/submit`, { token })).status, 200)
    assert.equal((await manage(id)).content_version, 3)
    assert.equal((await decide(id, 2)).status, 409)
  })
  await test('修订审核与通知原子回滚，失败不改变公开版或私有资产', async () => {
    await pool.query(`CREATE TRIGGER test_revision_failure BEFORE INSERT ON notifications FOR EACH ROW
      BEGIN IF NEW.target_id=${id} AND NEW.type='audit' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='revision rollback'; END IF; END`)
    try {
      assert.equal((await decide(id, 3)).status, 500)
      assert.equal((await publicPost(id)).title, original.title)
      assert.equal((await manage(id)).status, 'pending')
      const [[n]] = await pool.execute('SELECT COUNT(*) AS n FROM post_reviews WHERE post_id=? AND content_version=3', [id])
      assert.equal(n.n, 0)
    } finally { await pool.query('DROP TRIGGER test_revision_failure') }
  })
  await test('通过后正文/标签/媒体/游戏一起替换，首次时间、互动关系及文章id保留', async () => {
    assert.equal((await decide(id, 3)).status, 200)
    const visible = await publicPost(id)
    for (const field of ['title','content','cover','game_id','category']) assert.equal(visible[field], revised[field])
    assert.deepEqual(visible.tags, revised.tags); assert.ok(visible.media.some(m => m.url === newVideo))
    for (const field of ['id','published_at','like_count','comment_count','favorite_count']) assert.deepEqual(visible[field], original[field])
    assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM post_revisions WHERE post_id=?', [id]))[0][0].n, 0)
    const row = (await http('GET', `/posts?ids=${id}`)).data.data.list[0]
    assert.equal(row.has_video, true); assert.equal(row.game_id, 2)
    assert.equal((await fetch('http://127.0.0.1:3199' + newVideo, { headers: { Range: 'bytes=2-5' } })).status, 206)
    assert.equal((await decide(id, 3)).status, 409)
    const review = (await http('GET', `/admin/posts/${id}/review`, { token: admin })).data.data
    assert.equal(review.reviews.length, 2)
  })
  await test('并发保存一成功一冲突；并发审核只有一条最终记录', async () => {
    const race = await mkPost(owner)
    const saves = await Promise.all(['A','B'].map(title => edit(race, 1, { title })))
    assert.deepEqual(saves.map(r => r.status).sort(), [200,409])
    const decisions = await Promise.all([decide(race,2),decide(race,2,false)])
    assert.deepEqual(decisions.map(r => r.status).sort(), [200,409])
    assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM post_reviews WHERE post_id=?', [race]))[0][0].n, 1)
    assert.equal((await http('GET', `/posts/${race}`)).status, 200)
  })
  await test('再次修订仅改变新修订，丢弃的修订资源延迟回收，引用中资源不被清理', async () => {
    const temporary = await image()
    assert.equal((await edit(id, 3, { cover: temporary })).status, 200)
    const [[asset]] = await pool.execute('SELECT id,status FROM upload_assets WHERE owner_id=? AND url=?', [owner,temporary])
    assert.equal(asset.status, 'attached')
    assert.equal(await assets.expireTemporaryAsset(asset.id, { id: owner, role: 'creator' }), 'attached')
    await pool.execute("UPDATE upload_assets SET status='deleted' WHERE id=?", [asset.id])
    assert.equal(await cleanup.cleanupExpiredAssets({ assetIds: [asset.id] }), 0)
    await pool.execute("UPDATE upload_assets SET status='attached' WHERE id=?", [asset.id])
    assert.equal((await edit(id, 4, { cover: newCover })).status, 200)
    const [[released]] = await pool.execute('SELECT status,expires_at FROM upload_assets WHERE id=?', [asset.id])
    assert.equal(released.status, 'temporary'); assert.ok(released.expires_at)
    assert.equal((await publicPost(id)).cover, newCover)
  })
  await test('删除文章级联修订和引用，独占修订图片回到临时回收队列', async () => {
    const doomed = await mkPost(owner), cover = await image()
    assert.equal((await edit(doomed, 1, { cover })).status, 200)
    assert.equal((await http('DELETE', `/posts/${doomed}`, { token })).status, 200)
    assert.equal((await pool.execute('SELECT COUNT(*) AS n FROM post_revisions WHERE post_id=?', [doomed]))[0][0].n, 0)
    assert.equal((await pool.execute('SELECT status FROM upload_assets WHERE owner_id=? AND url=?', [owner,cover]))[0][0].status, 'temporary')
    assert.equal((await http('GET', `/posts/${doomed}`)).status, 404)
  })
}
