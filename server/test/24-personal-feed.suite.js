const H = require('./helpers')
module.exports = async function () {
  const { test, assert, http, mkUser, mkPost, makeToken, pool } = H
  const reader = await mkUser('feedreader'), otherReader = await mkUser('feedotherreader')
  const author = await mkUser('feedauthor', { role:'creator', apply:'approved' })
  const other = await mkUser('feedotherauthor', { role:'creator', apply:'approved' })
  const token = makeToken(reader,'feedreader','user')
  const ids = []
  for (const [user,game_id,status] of [[author,1,'published'],[author,1,'published'],[author,2,'published'],[author,1,'pending'],[author,1,'draft'],[author,1,'rejected'],[other,1,'published']]) ids.push(await mkPost(user,{ game_id,status }))
  await pool.execute('INSERT INTO follows(follower_id,following_id) VALUES (?,?),(?,?)',[reader,author,otherReader,other])
  await pool.execute("INSERT INTO favorites(user_id,post_id,created_at) VALUES (?,?,'2026-09-01'),(?,?,'2026-09-01'),(?,?,'2026-09-01'),(?,?,'2026-09-01'),(?,?,'2026-09-01')",[reader,ids[0],reader,ids[1],reader,ids[2],reader,ids[3],otherReader,ids[6]])
  await require('../src/services/postService').setTags(ids[0],['翻滚','耐力'])
  await pool.execute("INSERT INTO media (post_id,url,type) VALUES (?,?,'video')",[ids[0],'/uploads/videos/personal-feed.mp4'])
  await pool.execute('UPDATE posts SET published_at=? WHERE user_id=? AND status=?',['2026-09-01 12:00:00',author,'published'])
  const get = async path => (await http('GET',path,{ token })).data.data
  await test('个人攻略列表鉴权和游戏编号边界', async () => {
    for (const path of ['/favorites','/following-feed']) {
      assert.equal((await http('GET',path)).status,401)
      for (const query of ['game_id=0','game_id=abc','game_id=-1','game_id=1.5','game_id=9007199254740993','game_id=1&game_id=2','game_id[x]=1']) assert.equal((await http('GET',`${path}?${query}`,{ token })).status,400)
      const page = await get(`${path}?pageSize=999`); assert.equal(page.pageSize,50)
    }
  })
  await test('收藏游戏筛选、稳定分页及摘要字段，不能读取他人收藏或待审正文', async () => {
    const a = await get(`/favorites?game_id=1&pageSize=1&user_id=${otherReader}`)
    const b = await get('/favorites?game_id=1&pageSize=1&page=2')
    assert.equal(a.total,2); assert.equal(b.total,2)
    assert.deepEqual([a.list[0].id,b.list[0].id],[ids[1],ids[0]])
    assert.deepEqual([...b.list[0].tags].sort(),['翻滚','耐力'].sort())
    for (const post of [a.list[0],b.list[0]]) {
      assert.equal(post.status,'published'); assert.ok(post.game_name)
      assert.equal(post.has_video,post.id===ids[0])
      for (const key of ['content','guide_info','media']) assert.ok(!(key in post))
    }
    assert.equal((await get('/favorites?game_id=2')).total,1)
    assert.equal((await get('/favorites?game_id=9999999')).total,0)
    assert.equal((await get('/favorites')).total,3)
  })
  await test('关注动态只含已发布关注作者，按发布时间与id稳定排序，数量跟随筛选', async () => {
    const all = await get(`/following-feed?user_id=${otherReader}&following_user_id=${otherReader}`)
    assert.equal(all.total,3); assert.deepEqual(all.list.map(p=>p.id),ids.slice(0,3).reverse())
    assert.ok(all.list.every(p=>p.has_video===(p.id===ids[0])))
    const a = await get('/following-feed?game_id=1&pageSize=1')
    const b = await get('/following-feed?game_id=1&pageSize=1&page=2')
    assert.equal(a.total,2); assert.equal(b.total,2)
    assert.deepEqual([a.list[0].id,b.list[0].id],[ids[1],ids[0]])
    assert.ok(all.list.every(p=>p.user_id===author && !('content' in p)))
    const emptyToken=makeToken(other,'feedotherauthor','creator')
    assert.equal((await http('GET','/following-feed',{ token:emptyToken })).data.data.total,0)
  })
  await test('游戏停用不影响历史收藏/动态，下架后立即隐藏，取消关注后清空动态', async () => {
    const [[game]] = await pool.execute('SELECT status FROM games WHERE id=2')
    try {
      await pool.execute('UPDATE games SET status=0 WHERE id=2')
      assert.equal((await get('/favorites?game_id=2')).total,1)
      assert.equal((await get('/following-feed?game_id=2')).total,1)
    } finally { await pool.execute('UPDATE games SET status=? WHERE id=2',[game.status]) }
    await pool.execute("UPDATE posts SET status='rejected' WHERE id=?",[ids[0]])
    assert.equal((await get('/favorites?game_id=1')).total,1)
    assert.equal((await get('/following-feed?game_id=1')).total,1)
    await http('POST',`/follows/${author}`,{ token })
    assert.equal((await get('/following-feed')).total,0)
    assert.equal((await get('/favorites')).total,2)
  })
}
