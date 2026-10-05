const H = require('./helpers')
module.exports = async function () {
  const { test, assert, http, mkUser, makeToken, mkPost, pool, created, registerAsset } = H
  const author = await mkUser('guideexperience', { role:'creator', apply:'approved' })
  const token = makeToken(author, 'guideexperience', 'creator')
  const base = { title:'打法整理', content:'<h2>准备</h2><p>正文</p>', game_id:1, category:'BOSS攻略' }
  const info = { summary:'先观察再输出', game_version:'1.00', prerequisites:'一周目', spoiler:'minor', video_chapters:[] }
  async function create(extra = {}) {
    const r = await http('POST','/posts',{ token, body:{ ...base, ...extra } })
    if (r.status === 200 && !created.posts.includes(r.data.data.id)) created.posts.push(r.data.data.id)
    return r
  }
  await test('攻略概况保存、部分更新保留、公开及审核详情可读', async () => {
    const r = await create({ guide_info:info }); assert.equal(r.status,200)
    const id = r.data.data.id
    const first = (await http('GET',`/posts/manage/${id}`,{ token })).data.data
    assert.deepEqual(first.guide_info,info)
    assert.equal((await http('PUT',`/posts/${id}`,{ token, body:{ title:'修改标题', content_version:1 } })).status,200)
    assert.deepEqual((await http('GET',`/posts/manage/${id}`,{ token })).data.data.guide_info,info)
    await pool.execute("UPDATE posts SET status='published' WHERE id=?",[id])
    assert.deepEqual((await http('GET',`/posts/${id}`)).data.data.guide_info,info)
    const snapshot = await require('../src/services/adminService').getReviewDetail(id)
    assert.deepEqual(snapshot.guide_info,info)
    assert.equal((await http('PUT',`/posts/${id}`,{ token, body:{ guide_info:null, content_version:2 } })).status,200)
    assert.equal((await http('GET',`/posts/manage/${id}`,{ token })).data.data.guide_info,null)
  })
  await test('旧攻略无概况兼容，幂等包含新字段且保持旧请求哈希', async () => {
    const request_id = require('crypto').randomUUID()
    const a = await create({ request_id }); const b = await create({ request_id, guide_info:{} })
    assert.equal(a.status,200); assert.equal(b.status,200); assert.equal(a.data.data.id,b.data.data.id)
    assert.equal((await http('GET',`/posts/manage/${a.data.data.id}`,{ token })).data.data.guide_info,null)
    const key = require('crypto').randomUUID()
    const c = await create({ request_id:key, guide_info:info })
    const d = await create({ request_id:key, guide_info:{ ...info, summary:'新结论' } })
    assert.equal(c.status,200); assert.equal(d.status,409)
  })
  await test('攻略概况边界、剧透枚举和时间点顺序错误均拒绝', async () => {
    for (const guide_info of [{ summary:'字'.repeat(401) }, { spoiler:'invalid' }, { video_chapters:[{ seconds:10,title:'A' },{ seconds:9,title:'B' }] }, { video_chapters:[{ seconds:0,title:'A' }] }, { video_chapters:[{ seconds:1.5,title:'A' }] }, { unknown:true }]) {
      assert.equal((await create({ guide_info })).status,400)
    }
  })
  await test('视频时间点需要视频，移除主视频时兼容旧编辑器并清理时间点', async () => {
    const url = `/uploads/videos/guide-${Date.now()}.mp4`
    await registerAsset(author,url,'video')
    const guide_info = { ...info, video_chapters:[{ seconds:0,title:'准备' },{ seconds:15,title:'打法' }] }
    const r = await create({ video:url, guide_info }); assert.equal(r.status,200)
    const id = r.data.data.id
    assert.equal((await http('PUT',`/posts/${id}`,{ token,body:{ video:null, guide_info, content_version:1 } })).status,400)
    assert.equal((await http('PUT',`/posts/${id}`,{ token,body:{ video:null, content_version:1 } })).status,200)
    const p = (await http('GET',`/posts/manage/${id}`,{ token })).data.data
    assert.deepEqual(p.guide_info.video_chapters,[]); assert.equal(p.guide_info.summary,info.summary)
  })
  await test('标题与标签字面搜索，组合游戏分类筛选，分页不重复且不包含待审', async () => {
    const term = `guide_${Date.now()}`
    const ids = []
    for (const [title,category,game_id,status] of [[term,'BOSS攻略',1,'published'],['标签命中','BOSS攻略',1,'published'],[term,'新手入门',1,'published'],[term,'BOSS攻略',2,'published'],[term,'BOSS攻略',1,'pending']]) {
      ids.push(await mkPost(author,{ title,category,game_id,status }))
    }
    await require('../src/services/postService').setTags(ids[1],[term, term+'-extra'])
    const query = `keyword=${encodeURIComponent(term)}&user_id=${author}&game_id=1&category=${encodeURIComponent('BOSS攻略')}&pageSize=1`
    const a = (await http('GET',`/posts?${query}&page=1`)).data.data
    const b = (await http('GET',`/posts?${query}&page=2`)).data.data
    assert.equal(a.total,2); assert.equal(b.total,2)
    assert.deepEqual([a.list[0].id,b.list[0].id].sort((x,y)=>x-y),ids.slice(0,2).sort((x,y)=>x-y))
    const literal = await mkPost(author,{ title:'100%_!' })
    const wildcard = (await http('GET',`/posts?user_id=${author}&keyword=${encodeURIComponent('%_!')}`)).data.data
    assert.equal(wildcard.total,1); assert.equal(wildcard.list[0].id,literal)
    assert.equal((await http('GET','/posts?category=unknown')).status,400)
    assert.equal((await http('GET','/posts?game_id=abc')).status,400)
  })
}
