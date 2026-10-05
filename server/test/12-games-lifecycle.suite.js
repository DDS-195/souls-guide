const H = require('./helpers')
module.exports = async function () {
  const {test,http,mkGame,mkUser,mkPost,makeToken,pool,assert} = H
  const token = await H.adminToken()
  const gid = await mkGame('game_lifecycle_' + H.SEQ)
  const state = async id => (await pool.execute('SELECT * FROM games WHERE id=?',[id]))[0][0]
  const update = (id,body) => http('PUT',`/games/${id}`,{token,body})
  await test('游戏参数拒绝纯空白、错误类型、非法状态/排序和缺失版本', async () => {
    for (const name of ['  ', {}, 123, 'x'.repeat(51)]) assert.equal((await http('POST','/games',{token,body:{name}})).status,400)
    for (const fields of [{status:2},{status:'1'},{sort_order:-1},{sort_order:1.5},{description:{}},{cover:'/uploads/../secret'},{}]) {
      assert.equal((await update(gid,{...fields,version:1})).status,400)
    }
    assert.equal((await update(gid,{name:'缺版本'})).status,400)
  })
  await test('游戏改名后旧版本启停不能覆盖，状态更新不改变资料', async () => {
    assert.equal((await update(gid,{name:'renamed_'+H.SEQ,description:'new',version:1})).status,200)
    assert.equal((await update(gid,{status:0,version:1})).status,409)
    assert.equal((await update(gid,{status:0,version:2})).status,200)
    assert.equal((await state(gid)).description,'new')
  })
  await test('公开默认隐藏停用，历史筛选保留停用游戏', async () => {
    assert.ok(!(await http('GET','/games')).data.data.some(g=>g.id===gid))
    assert.ok((await http('GET','/games?include_inactive=1')).data.data.some(g=>g.id===gid && g.status===0))
  })
  await test('停用游戏禁止新增/迁入文章，旧文章可保留原归属且仍可读', async () => {
    const author = await mkUser('gamelifecycle_author',{role:'creator'})
    const authorToken = makeToken(author,'gamelifecycle_author','creator')
    const body = {title:'生命周期测试',content:'<p>内容</p>',game_id:gid,category:'BOSS攻略'}
    assert.equal((await http('POST','/posts',{token:authorToken,body})).status,400)
    const old = await mkPost(author,{game_id:gid,status:'published'})
    assert.equal((await http('GET',`/posts/${old}`)).status,200)
    assert.equal((await http('PUT',`/posts/${old}`,{token:authorToken,body:{content_version:1,game_id:gid,title:'旧文章修改'}})).status,200)
    const other = await mkPost(author,{game_id:1})
    assert.equal((await http('PUT',`/posts/${other}`,{token:authorToken,body:{content_version:1,game_id:gid}})).status,400)
    const games = (await http('GET','/admin/games',{token})).data.data
    assert.equal(games.find(g=>g.id===gid).post_count,1)
  })
  await test('并发排序只成功一次，失败排序不部分写入', async () => {
    const second = await mkGame('game_sort_'+H.SEQ)
    const a = await state(gid), b = await state(second)
    const body = [{id:gid,version:a.version,sort_order:9},{id:second,version:b.version,sort_order:10}]
    const results = await Promise.all([http('PUT','/games/sort',{token,body}),http('PUT','/games/sort',{token,body})])
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
    const before = await state(second)
    assert.equal((await http('PUT','/games/sort',{token,body:[{id:second,version:before.version,sort_order:99},{id:gid,version:1,sort_order:98}]})).status,409)
    assert.equal((await state(second)).sort_order,before.sort_order)
  })
  await test('新增默认追加末尾，删除使用版本且封面清理进入事务队列', async () => {
    const before = (await pool.execute('SELECT MAX(sort_order) n FROM games'))[0][0].n
    const created = await http('POST','/games',{token,body:{name:' game_append_'+H.SEQ+' ',cover:'/uploads/images/game-test-cover.png'}})
    assert.equal(created.status,200)
    const id = created.data.data.id
    H.created.games.push(id)
    assert.equal((await state(id)).sort_order,before+1)
    assert.equal((await state(id)).name,'game_append_'+H.SEQ)
    assert.equal((await http('DELETE',`/games/${id}`,{token,body:{version:2}})).status,409)
    assert.equal((await http('DELETE',`/games/${id}`,{token,body:{version:1}})).status,200)
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM game_cover_cleanup WHERE url=?',['/uploads/images/game-test-cover.png']))[0][0].n,1)
  })
}
