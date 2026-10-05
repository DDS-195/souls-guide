// 06 媒体模块：图片上传（白名单/大小/云盘占位回归）+ 视频分片断点续传全链路 + 媒体删除
const H = require('./helpers')
const crypto = require('crypto')
const fs = require('fs')
const { cleanupExpiredAssets } = require('../src/services/cleanupService')

module.exports = async function mediaSuite() {
  console.log('\n[06] 媒体模块 /api/media')
  const { test, http, mkUser, mkPost, makeToken, pool, created, trackFile, expectFile, urlToAbs, SERVER_ROOT, SEQ } = H
  const authorId = await mkUser('mauthor', { role: 'creator', apply: 'approved' })
  const authorTok = makeToken(authorId, 'mauthor', 'creator')

  // ---- 图片上传 ----
  await test('图片上传：无 token → 401 / 普通用户 → 403', async () => {
    H.assert.equal((await http('POST', '/media/upload/image', { form: H.pngForm() })).status, 401)
    const plain = await mkUser('mplain')
    H.assert.equal((await http('POST', '/media/upload/image', { token: makeToken(plain, 'mplain', 'user'), form: H.pngForm() })).status, 403)
  })
  let imgUrl = null
  await test('图片上传 creator → 200，临时资源仅凭预览授权访问', async () => {
    const r = await http('POST', '/media/upload/image', { token: authorTok, form: H.pngForm('real.png') })
    H.assert.equal(r.status, 200)
    imgUrl = trackFile(r.data.data.url)
    H.assert.ok(imgUrl.startsWith('/uploads/images/'))
    expectFile(imgUrl, true)
    H.assert.equal((await fetch('http://127.0.0.1:3199' + imgUrl)).status, 404)
    const s = await fetch('http://127.0.0.1:3199' + imgUrl, { headers: { Cookie: 'sg_media=' + r.headers['x-media-grant'] } })
    H.assert.equal(s.status, 200, '作者预览应可访问')
  })
  await test('octet-stream + 合法扩展名 → 200（云盘占位修复回归）', async () => {
    const r = await http('POST', '/media/upload/image', { token: authorTok, form: H.pngForm('cloud.png', 'application/octet-stream') })
    H.assert.equal(r.status, 200)
    trackFile(r.data.data.url)
  })
  await test('扩展名白名单外+非法 mimetype → 400（兜底拒绝）', async () => {
    // 后端设计：mimetype 合法直接放行；白名单兜底仅在 mimetype 非法/缺失时按扩展名判——构造双非法才能命中拒绝
    const f = new FormData()
    f.append('image', new File([Buffer.from('MZFAKE')], 'evil.exe', { type: 'application/x-msdownload' }))
    const r = await http('POST', '/media/upload/image', { token: authorTok, form: f })
    H.assert.equal(r.status, 400)
  })
  await test('伪造 image/png MIME 但内容不是图片 → 400', async () => {
    const f = new FormData()
    f.append('image', new File([Buffer.from('MZ_NOT_AN_IMAGE')], 'fake.png', { type: 'image/png' }))
    const r = await http('POST', '/media/upload/image', { token: authorTok, form: f })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '图片内容与文件格式不匹配')
  })
  await test('过期且未绑定的上传资产由清理任务安全回收', async () => {
    const r = await http('POST', '/media/upload/image', { token: authorTok, form: H.pngForm('orphan.png') })
    H.assert.equal(r.status, 200)
    const orphanUrl = trackFile(r.data.data.url)
    await pool.execute("UPDATE upload_assets SET expires_at=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id=?", [r.data.data.asset_id])
    H.assert.equal(await cleanupExpiredAssets({ assetIds: [r.data.data.asset_id] }), 1)
    expectFile(orphanUrl, false)
    const [[asset]] = await pool.execute('SELECT COUNT(*) c FROM upload_assets WHERE id=?', [r.data.data.asset_id])
    H.assert.equal(asset.c, 0)
  })
  await test('临时上传可由所有者主动删除，他人和已绑定资产不可绕过', async () => {
    const uploaded = await http('POST', '/media/upload/image', { token: authorTok, form: H.pngForm('discard.png') })
    const discardUrl = trackFile(uploaded.data.data.url)
    const otherId = await mkUser('massetother', { role: 'creator', apply: 'approved' })
    const otherTok = makeToken(otherId, 'massetother', 'creator')
    H.assert.equal(
      (await http('DELETE', `/media/assets/${uploaded.data.data.asset_id}`, { token: otherTok })).status,
      403
    )
    H.assert.equal(
      (await http('DELETE', `/media/assets/${uploaded.data.data.asset_id}`, { token: authorTok })).status,
      200
    )
    expectFile(discardUrl, false)

    const attached = await http('POST', '/media/upload/image', { token: authorTok, form: H.pngForm('attached.png') })
    const attachedUrl = trackFile(attached.data.data.url)
    const pid = await mkPost(authorId, { status: 'draft', cover: attachedUrl })
    await H.attachAsset(authorId, pid, attachedUrl, 'image', 'cover')
    H.assert.equal(
      (await http('DELETE', `/media/assets/${attached.data.data.asset_id}`, { token: authorTok })).status,
      409
    )
    expectFile(attachedUrl, true)
  })
  await test('超 5MB 图片 → 400（busboy 边界：恰 5MB+64KB 内放行）', async () => {
    const nearLimit = Buffer.alloc(5 * 1024 * 1024 + 64 * 1024 - 1)
    H.PNG_1PX.copy(nearLimit, 0)
    const f = new FormData()
    f.append('image', new File([nearLimit], 'big.png', { type: 'image/png' }))
    const okBig = await http('POST', '/media/upload/image', { token: authorTok, form: f })
    H.assert.equal(okBig.status, 200, '5MB+64KB-1 应放行')
    trackFile(okBig.data.data.url) // 登记清理（5MB 测试文件）
    const overLimit = Buffer.alloc(5 * 1024 * 1024 + 64 * 1024 + 10)
    H.PNG_1PX.copy(overLimit, 0)
    const f2 = new FormData()
    f2.append('image', new File([overLimit], 'toobig.png', { type: 'image/png' }))
    const r = await http('POST', '/media/upload/image', { token: authorTok, form: f2 })
    H.assert.equal(r.status, 400, '超限应 400')
    H.assert.equal(r.data.message, '文件大小不能超过 5MB')
  })

  // ---- 视频分片断点续传（真实字节流全链路）----
  const CHUNK = 512 * 1024
  const TOTAL = 3
  const chunks = [0, 1, 2].map(() => crypto.randomBytes(CHUNK))
  const hash = crypto.createHash('md5').update(Buffer.concat(chunks)).digest('hex')
  const tmpDir = urlToAbs(`/uploads/videos/tmp/${authorId}-${hash}`)

  await test('video status：非法 hash → 400', async () => {
    const r = await http('POST', '/media/upload/video/status', { token: authorTok, body: { hash: 'not-a-hash' } })
    H.assert.equal(r.status, 400)
  })
  await test('video chunk：带文件名上传 → 200 幂等', async () => {
    const form = new FormData()
    form.append('hash', hash)
    form.append('index', '0')
    form.append('totalChunks', String(TOTAL))
    form.append('chunk', new File([chunks[0]], 'smoke.mp4', { type: 'video/mp4' }))
    const r1 = await http('POST', '/media/upload/video/chunk', { token: authorTok, form })
    H.assert.equal(r1.status, 200)
    H.assert.equal(r1.data.data.index, 0)
    const r2 = await http('POST', '/media/upload/video/chunk', { token: authorTok, form }) // 幂等重传
    H.assert.equal(r2.status, 200)
  })
  await test('video chunk：octet-stream 且不带文件名 → 400（2026-08-07 契约回归）', async () => {
    // 真实 bug 场景复现：mimetype 空（octet-stream）+ 无 filename（默认 "blob"）→ 扩展名白名单落空必 400
    const form = new FormData()
    form.append('hash', hash)
    form.append('index', '1')
    form.append('totalChunks', String(TOTAL))
    form.append('chunk', new Blob([chunks[1]], { type: 'application/octet-stream' })) // 无 filename → 默认 blob
    const r = await http('POST', '/media/upload/video/chunk', { token: authorTok, form })
    H.assert.equal(r.status, 400)
  })
  await test('video chunk：.exe → 400（白名单）', async () => {
    const form = new FormData()
    form.append('hash', hash)
    form.append('index', '1')
    form.append('totalChunks', String(TOTAL))
    form.append('chunk', new File([chunks[1]], 'evil.exe', { type: 'application/octet-stream' }))
    H.assert.equal((await http('POST', '/media/upload/video/chunk', { token: authorTok, form })).status, 400)
  })
  await test('video chunk：totalChunks>100 → 400', async () => {
    const form = new FormData()
    form.append('hash', hash)
    form.append('index', '0')
    form.append('totalChunks', '101')
    form.append('chunk', new File([chunks[0]], 'smoke.mp4', { type: 'video/mp4' }))
    // 前序大 body 请求后 undici 连接复用偶发 RST，重试一次
    let r
    try {
      r = await http('POST', '/media/upload/video/chunk', { token: authorTok, form })
    } catch {
      r = await http('POST', '/media/upload/video/chunk', { token: authorTok, form })
    }
    H.assert.equal(r.status, 400)
  })
  await test('merge 缺片 → 400 提示断点续传', async () => {
    // 前序 multipart 大请求后 undici 连接复用偶发 RST（fetch failed），重试一次规避连接竞态
    let r
    try {
      r = await http('POST', '/media/upload/video/merge', { token: authorTok, body: { hash, totalChunks: TOTAL, originalName: 'smoke.mp4' } })
    } catch {
      r = await http('POST', '/media/upload/video/merge', { token: authorTok, body: { hash, totalChunks: TOTAL, originalName: 'smoke.mp4' } })
    }
    H.assert.equal(r.status, 400)
    H.assert.ok(r.data.message.includes('分片不完整'))
  })
  await test('服务端合并 MD5 与请求 hash 不一致 → 400 且不生成成品', async () => {
    const wrongHash = crypto.randomBytes(16).toString('hex')
    const payload = crypto.randomBytes(64 * 1024)
    const form = new FormData()
    form.append('hash', wrongHash)
    form.append('index', '0')
    form.append('totalChunks', '1')
    form.append('chunk', new File([payload], 'bad-hash.mp4', { type: 'video/mp4' }))
    H.assert.equal((await http('POST', '/media/upload/video/chunk', { token: authorTok, form })).status, 200)
    const merged = await http('POST', '/media/upload/video/merge', { token: authorTok, body: { hash: wrongHash, totalChunks: 1, originalName: 'bad-hash.mp4' } })
    H.assert.equal(merged.status, 400)
    H.assert.ok(merged.data.message.includes('完整性校验失败'))
    created.dirs.push(urlToAbs(`/uploads/videos/tmp/${authorId}-${wrongHash}`))
  })
  let mergedUrl = null
  await test('补全分片 → status 列出已传片 → merge → 200 返回 url', async () => {
    for (const [i, buf] of [[1, chunks[1]], [2, chunks[2]]]) {
      const form = new FormData()
      form.append('hash', hash)
      form.append('index', String(i))
      form.append('totalChunks', String(TOTAL))
      form.append('chunk', new File([buf], 'smoke.mp4', { type: 'video/mp4' }))
      H.assert.equal((await http('POST', '/media/upload/video/chunk', { token: authorTok, form })).status, 200)
    }
    const st = await http('POST', '/media/upload/video/status', { token: authorTok, body: { hash } })
    H.assert.deepEqual(st.data.data.uploadedChunks, [0, 1, 2])
    const r = await http('POST', '/media/upload/video/merge', { token: authorTok, body: { hash, totalChunks: TOTAL, originalName: 'smoke.mp4' } })
    H.assert.equal(r.status, 200)
    mergedUrl = trackFile(r.data.data.url)
    H.assert.ok(mergedUrl.startsWith('/uploads/videos/'))
  })
  await test('合并产物完整：文件大小正确，匿名不可访问而作者可以预览', async () => {
    expectFile(mergedUrl, true)
    const size = fs.statSync(urlToAbs(mergedUrl)).size
    H.assert.equal(size, CHUNK * TOTAL)
    H.assert.equal((await fetch('http://127.0.0.1:3199' + mergedUrl)).status, 404)
    const me = await http('GET', '/users/me', { token: authorTok })
    const s = await fetch('http://127.0.0.1:3199' + mergedUrl, { headers: { Cookie: 'sg_media=' + me.headers['x-media-grant'] } })
    H.assert.equal(s.status, 200)
  })
  await test('merge 后 status 直接返回 url（__done__ 标记）', async () => {
    const st = await http('POST', '/media/upload/video/status', { token: authorTok, body: { hash } })
    H.assert.equal(st.data.data.url, mergedUrl)
  })
  await test('分片目录已清理（仅剩 __done__ 标记）', async () => {
    const files = fs.readdirSync(tmpDir)
    H.assert.deepEqual(files.sort(), ['__done__', '__owner__'])
    created.dirs.push(tmpDir) // 登记清理
  })

  // ---- 媒体删除（DELETE /media/:id）----
  await test('旧媒体删除入口：草稿/待审/已发布及admin均409，文章、引用、时间点不改变', async () => {
    const admin = await H.adminToken()
    for (const status of ['draft', 'pending', 'published']) {
      const pid = await mkPost(authorId, { status, video: mergedUrl })
      const guide = { summary: '观察起手', game_version: '', prerequisites: '', spoiler: 'none', video_chapters: [{ seconds: 0, title: '准备' }] }
      await pool.execute('UPDATE posts SET guide_info=? WHERE id=?', [JSON.stringify(guide), pid])
      await pool.execute('INSERT INTO media (post_id,url,type,sort_order) VALUES (?,?,?,?)', [pid, mergedUrl, 'video', 0])
      await H.attachAsset(authorId, pid, mergedUrl, 'video', 'video')
      const [[m]] = await pool.execute('SELECT id FROM media WHERE post_id=?', [pid])
      const before = (await http('GET', `/posts/manage/${pid}`, { token: authorTok })).data.data
      for (const token of [authorTok, admin]) {
        H.assert.equal((await http('DELETE', `/media/${m.id}`, { token })).status, 409)
      }
      const after = (await http('GET', `/posts/manage/${pid}`, { token: authorTok })).data.data
      H.assert.deepEqual(after, before)
      H.assert.equal((await pool.execute('SELECT COUNT(*) c FROM post_assets WHERE post_id=?', [pid]))[0][0].c, 1)
    }
    expectFile(mergedUrl, true)
  })
  await test('移除视频必须保存文章：递增版本、清空旧时间点、旧审核409且新审核快照正确', async () => {
    const admin = await H.adminToken()
    const pid = await mkPost(authorId, { status: 'pending', video: mergedUrl })
    const guide = { summary: '观察起手', game_version: '', prerequisites: '', spoiler: 'none', video_chapters: [{ seconds: 0, title: '准备' }] }
    await pool.execute('UPDATE posts SET guide_info=? WHERE id=?', [JSON.stringify(guide), pid])
    await pool.execute('INSERT INTO media (post_id,url,type,sort_order) VALUES (?,?,?,?)', [pid, mergedUrl, 'video', 0])
    await H.attachAsset(authorId, pid, mergedUrl, 'video', 'video')
    const saved = await http('PUT', `/posts/${pid}`, { token: authorTok, body: { video: null, content_version: 1 } })
    H.assert.equal(saved.status, 200)
    H.assert.equal(saved.data.data.content_version, 2)
    H.assert.equal(saved.data.data.status, 'pending')
    H.assert.equal((await http('PUT', `/admin/posts/${pid}/approve`, { token: admin, body: { content_version: 1 } })).status, 409)
    H.assert.equal((await http('PUT', `/admin/posts/${pid}/approve`, { token: admin, body: { content_version: 2 } })).status, 200)
    const [[review]] = await pool.execute('SELECT snapshot FROM post_reviews WHERE post_id=?', [pid])
    const snapshot = typeof review.snapshot === 'string' ? JSON.parse(review.snapshot) : review.snapshot
    H.assert.deepEqual(snapshot.media, [])
    H.assert.deepEqual(snapshot.guide_info.video_chapters, [])
    H.assert.equal((await pool.execute('SELECT COUNT(*) c FROM post_assets WHERE post_id=?', [pid]))[0][0].c, 0)
  })
  await test('旧接口不能破坏公开正文图片：HTML、引用和匿名图片访问均保留', async () => {
    const content = `<p>观察站位</p><img src="${imgUrl}" alt="站位">`
    const pid = await mkPost(authorId, { status: 'published', content })
    await pool.execute('INSERT INTO media (post_id,url,type,sort_order) VALUES (?,?,?,?)', [pid, imgUrl, 'image', 1])
    await H.attachAsset(authorId, pid, imgUrl, 'image', 'content')
    const [[m]] = await pool.execute('SELECT id FROM media WHERE post_id=?', [pid])
    H.assert.equal((await http('DELETE', `/media/${m.id}`, { token: authorTok })).status, 409)
    const post = (await http('GET', `/posts/${pid}`)).data.data
    H.assert.equal(post.content, content)
    H.assert.equal(post.content_version, 1)
    H.assert.equal(post.media.length, 1)
    H.assert.equal((await fetch('http://127.0.0.1:3199' + imgUrl)).status, 200)
  })
  await test('DELETE /media/:id：他人 → 403', async () => {
    const pid = await mkPost(authorId, { status: 'draft', video: '/uploads/videos/2026/08/other.mp4' })
    await pool.execute('INSERT INTO media (post_id, url, type, sort_order) VALUES (?,?,?,?)', [pid, '/uploads/videos/2026/08/other.mp4', 'video', 0])
    const [[m]] = await pool.execute('SELECT id FROM media WHERE post_id=?', [pid])
    const other = await mkUser('mmediaother', { role: 'creator', apply: 'approved' })
    const r = await http('DELETE', `/media/${m.id}`, { token: makeToken(other, 'mmediaother', 'creator') })
    H.assert.equal(r.status, 403)
  })
  await test('DELETE /media/:id：不存在 → 404', async () => {
    H.assert.equal((await http('DELETE', '/media/99999999', { token: authorTok })).status, 404)
  })
}
