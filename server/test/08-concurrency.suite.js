// 08 并发一致性测试（2026-08-13，第 1 批整改 A1/A2/A4 验证）
// 方法：Promise.all 同时发起 N 个真实 HTTP 请求，断言「最终状态强一致」而非中间结果
// A1：并发删评论 → comment_count 恒等于真实行数
// A2：并发 toggle 点赞/收藏/关注 → 行数与计数强一致、通知不重复
// A4：并发 merge 同 hash → 同一 URL、文件完整、无失败
const H = require('./helpers')
const crypto = require('crypto')
const fs = require('fs')

module.exports = async function concurrencySuite() {
  console.log('\n[08] 并发一致性（A1/A2/A4）')
  const { test, http, mkUser, mkPost, makeToken, pool, trackFile, expectFile, urlToAbs, created, SEQ } = H
  const authorId = await mkUser('cauthor', { role: 'creator', apply: 'approved' })
  const readerId = await mkUser('creader')
  const authorTok = makeToken(authorId, 'cauthor', 'creator')
  const readerTok = makeToken(readerId, 'creader', 'user')

  // ================= A1：并发删评论 → 计数拉平 =================
  await test('A1 并发删除评论 → comment_count 恒等于真实行数', async () => {
    const pid = await mkPost(authorId, { status: 'published' })
    // 建 3 条顶层评论
    const ids = []
    for (let i = 0; i < 3; i++) {
      const r = await http('POST', `/posts/${pid}/comments`, { token: readerTok, body: { content: `c${i}` } })
      ids.push(r.data.data.id)
    }
    const [[before]] = await pool.execute('SELECT comment_count FROM posts WHERE id=?', [pid])
    H.assert.equal(before.comment_count, 3)
    // 并发同时删 2 条（无回复，每条等价）
    const results = await Promise.all([
      http('DELETE', `/comments/${ids[0]}`, { token: readerTok }),
      http('DELETE', `/comments/${ids[1]}`, { token: readerTok }),
    ])
    H.assert.ok(results.every(r => r.status === 200), '并发删除均应 200')
    const [[after]] = await pool.execute('SELECT comment_count FROM posts WHERE id=?', [pid])
    const [[real]] = await pool.execute('SELECT COUNT(*) c FROM comments WHERE post_id=?', [pid])
    H.assert.equal(after.comment_count, real.c, `计数=${after.comment_count} 实际行数=${real.c}`)
    H.assert.equal(real.c, 1, '应只剩 1 条')
  })

  await test('A1 多轮并发删除（10 轮 × 2 并发）计数始终一致', async () => {
    const pid = await mkPost(authorId, { status: 'published' })
    for (let round = 0; round < 10; round++) {
      // 每轮补 2 条新评论再并发删
      const a = await http('POST', `/posts/${pid}/comments`, { token: readerTok, body: { content: `r${round}a` } })
      const b = await http('POST', `/posts/${pid}/comments`, { token: readerTok, body: { content: `r${round}b` } })
      await Promise.all([
        http('DELETE', `/comments/${a.data.data.id}`, { token: readerTok }),
        http('DELETE', `/comments/${b.data.data.id}`, { token: readerTok }),
      ])
      const [[cnt]] = await pool.execute('SELECT comment_count FROM posts WHERE id=?', [pid])
      const [[real]] = await pool.execute('SELECT COUNT(*) c FROM comments WHERE post_id=?', [pid])
      H.assert.equal(cnt.comment_count, real.c, `第 ${round} 轮：计数=${cnt.comment_count} 实际=${real.c}`)
    }
  })

  // ================= A2：并发 toggle → 行数与计数强一致 =================
  await test('A2 并发 5 次点赞 → 最终行数=计数=1 且通知数=点赞成功次数', async () => {
    const pid = await mkPost(authorId, { status: 'published' })
    const rs = await Promise.all(Array.from({ length: 5 }, () => http('POST', `/posts/${pid}/like`, { token: readerTok })))
    H.assert.ok(rs.every(r => r.status === 200), '并发点赞均 200')
    // FOR UPDATE 行锁串行化 → 5 次 toggle 线性化：第 1/3/5 次点赞、第 2/4 次取消 → 最终点赞态
    const trues = rs.filter(r => r.data.data.liked === true).length
    H.assert.equal(trues, 3, '点赞成功的响应应恰 3 次')
    const [[lk]] = await pool.execute('SELECT COUNT(*) c FROM likes WHERE user_id=? AND post_id=?', [readerId, pid])
    const [[p]] = await pool.execute('SELECT like_count FROM posts WHERE id=?', [pid])
    H.assert.equal(lk.c, 1, '点赞行应为 1')
    H.assert.equal(p.like_count, 1, `like_count 应为 1（实际 ${p.like_count}）`)
    // 通知一致性：每点赞成功一次发一条（设计 4.3），取消不发 → 通知数 === 点赞成功次数
    const [[n]] = await pool.execute('SELECT COUNT(*) c FROM notifications WHERE sender_id=? AND receiver_id=? AND type=? AND target_id=?',
      [readerId, authorId, 'like', pid])
    H.assert.equal(n.c, trues, `通知应恰 ${trues} 条（实际 ${n.c}）`)
    // 复原（再 toggle 一次取消）
    await http('POST', `/posts/${pid}/like`, { token: readerTok })
  })

  await test('A2 并发 4 次收藏（偶数）→ 最终未收藏且行=0', async () => {
    const pid = await mkPost(authorId, { status: 'published' })
    const rs = await Promise.all(Array.from({ length: 4 }, () => http('POST', `/posts/${pid}/favorite`, { token: readerTok })))
    H.assert.ok(rs.every(r => r.status === 200))
    const [[fav]] = await pool.execute('SELECT COUNT(*) c FROM favorites WHERE user_id=? AND post_id=?', [readerId, pid])
    H.assert.equal(fav.c, 0, '4 次 toggle 后收藏行应为 0')
  })

  await test('A2 并发 3 次关注（奇数）→ 最终已关注且通知数=关注成功次数', async () => {
    const rs = await Promise.all(Array.from({ length: 3 }, () => http('POST', `/follows/${authorId}`, { token: readerTok })))
    H.assert.ok(rs.every(r => r.status === 200))
    const trues = rs.filter(r => r.data.data.following === true).length
    H.assert.equal(trues, 2, '3 次串行 toggle：第 1/3 次关注成功')
    const [[f]] = await pool.execute('SELECT COUNT(*) c FROM follows WHERE follower_id=? AND following_id=?', [readerId, authorId])
    H.assert.equal(f.c, 1, '3 次 toggle 后关注行应为 1')
    const [[n]] = await pool.execute('SELECT COUNT(*) c FROM notifications WHERE sender_id=? AND receiver_id=? AND type=?',
      [readerId, authorId, 'follow'])
    H.assert.equal(n.c, trues, `关注通知应恰 ${trues} 条（实际 ${n.c}）`)
    await http('POST', `/follows/${authorId}`, { token: readerTok }) // 复原
  })

  await test('A2 双用户并发点赞同一文章 → 两行两计数', async () => {
    const pid = await mkPost(authorId, { status: 'published' })
    const otherId = await mkUser('cother')
    const otherTok = makeToken(otherId, 'cother', 'user')
    const rs = await Promise.all([
      http('POST', `/posts/${pid}/like`, { token: readerTok }),
      http('POST', `/posts/${pid}/like`, { token: otherTok }),
    ])
    H.assert.ok(rs.every(r => r.status === 200 && r.data.data.liked === true))
    const [[lk]] = await pool.execute('SELECT COUNT(*) c FROM likes WHERE post_id=?', [pid])
    const [[p]] = await pool.execute('SELECT like_count FROM posts WHERE id=?', [pid])
    H.assert.equal(lk.c, 2)
    H.assert.equal(p.like_count, 2, `两人点赞后计数应为 2（实际 ${p.like_count}）`)
  })

  // ================= A4：并发 merge 同 hash =================
  await test('A4 并发 2 次 merge 同 hash → 同一 URL + 文件完整', async () => {
    const hash = crypto.randomBytes(16).toString('hex')
    const CHUNK = 256 * 1024
    const TOTAL = 2
    const chunks = [crypto.randomBytes(CHUNK), crypto.randomBytes(CHUNK)]
    for (const [i, buf] of chunks.entries()) {
      const form = new FormData()
      form.append('hash', hash)
      form.append('index', String(i))
      form.append('totalChunks', String(TOTAL))
      form.append('chunk', new File([buf], 'conc.mp4', { type: 'video/mp4' }))
      H.assert.equal((await http('POST', '/media/upload/video/chunk', { token: authorTok, form })).status, 200)
    }
    // 并发两次 merge
    const rs = await Promise.all([
      http('POST', '/media/upload/video/merge', { token: authorTok, body: { hash, totalChunks: TOTAL, originalName: 'conc.mp4' } }),
      http('POST', '/media/upload/video/merge', { token: authorTok, body: { hash, totalChunks: TOTAL, originalName: 'conc.mp4' } }),
    ])
    H.assert.ok(rs.every(r => r.status === 200), '并发 merge 均应 200')
    const u1 = trackFile(rs[0].data.data.url)
    const u2 = rs[1].data.data.url
    H.assert.equal(u1, u2, '应返回同一 URL')
    expectFile(u1, true)
    const size = fs.statSync(urlToAbs(u1)).size
    H.assert.equal(size, CHUNK * TOTAL, '合并产物字节数应完整')
    // 登记清理（__done__ 目录 + 合并文件）
    created.dirs.push(urlToAbs(`/uploads/videos/tmp/${hash}`))
  })

  await test('A4 merge 失败后锁释放 → 可重试（缺片 400 后补片重 merge 200）', async () => {
    const hash = crypto.randomBytes(16).toString('hex')
    const CHUNK = 128 * 1024
    const TOTAL = 2
    const form = new FormData()
    form.append('hash', hash)
    form.append('index', '0')
    form.append('totalChunks', String(TOTAL))
    form.append('chunk', new File([crypto.randomBytes(CHUNK)], 'retry.mp4', { type: 'video/mp4' }))
    H.assert.equal((await http('POST', '/media/upload/video/chunk', { token: authorTok, form })).status, 200)
    // 第一次 merge：缺片 → 400（锁应随失败释放）
    const fail = await http('POST', '/media/upload/video/merge', { token: authorTok, body: { hash, totalChunks: TOTAL, originalName: 'retry.mp4' } })
    H.assert.equal(fail.status, 400)
    // 补片后重 merge：锁已释放 → 200
    const form2 = new FormData()
    form2.append('hash', hash)
    form2.append('index', '1')
    form2.append('totalChunks', String(TOTAL))
    form2.append('chunk', new File([crypto.randomBytes(CHUNK)], 'retry.mp4', { type: 'video/mp4' }))
    H.assert.equal((await http('POST', '/media/upload/video/chunk', { token: authorTok, form: form2 })).status, 200)
    const ok = await http('POST', '/media/upload/video/merge', { token: authorTok, body: { hash, totalChunks: TOTAL, originalName: 'retry.mp4' } })
    H.assert.equal(ok.status, 200)
    trackFile(ok.data.data.url)
    created.dirs.push(urlToAbs(`/uploads/videos/tmp/${hash}`))
  })
}
