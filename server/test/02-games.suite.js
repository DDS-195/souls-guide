// 02 游戏模块：公开列表/管理 CRUD/排序/部分更新修复/RESTRICT 删除
const H = require('./helpers')

module.exports = async function gamesSuite() {
  console.log('\n[02] 游戏模块 /api/games')
  const { test, http, mkUser, mkGame, mkPost, makeToken, adminToken, pool, created, SEQ } = H
  let adminTok = ''
  await adminToken().then(t => adminTok = t)

  await test('GET /games 公开 → 200 且 ≥7 条启用游戏', async () => {
    const r = await http('GET', '/games')
    H.assert.equal(r.status, 200)
    H.assert.ok(Array.isArray(r.data.data))
    H.assert.ok(r.data.data.length >= 7)
    H.assert.ok(r.data.data.every(g => g.status === 1))
    H.assert.ok(r.data.data.some(g => g.name === '艾尔登法环'))
  })
  await test('POST /games 无 token → 401', async () => {
    const r = await http('POST', '/games', { body: { name: 'x' } })
    H.assert.equal(r.status, 401)
  })
  await test('POST /games 普通用户 → 403', async () => {
    const uid = await mkUser('guser')
    const r = await http('POST', '/games', { token: makeToken(uid, 'guser', 'user'), body: { name: 'x' } })
    H.assert.equal(r.status, 403)
  })
  let gid = null
  await test('POST /games admin → 200 创建成功', async () => {
    const r = await http('POST', '/games', { token: adminTok, body: { name: `testgame_${SEQ}`, description: 'desc', sort_order: 99 } })
    H.assert.equal(r.status, 200)
    gid = r.data.data.id
    created.games.push(gid)
  })
  await test('重名游戏 → 400', async () => {
    const r = await http('POST', '/games', { token: adminTok, body: { name: `testgame_${SEQ}` } })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '游戏名已存在')
  })
  await test('游戏名超 50 字 → 400（P1-1 修复）', async () => {
    const r = await http('POST', '/games', { token: adminTok, body: { name: 'x'.repeat(51) } })
    H.assert.equal(r.status, 400)
  })
  await test('PUT /games/:id 编辑 → 200', async () => {
    const r = await http('PUT', `/games/${gid}`, { token: adminTok, body: { name: `testgame_${SEQ}`, description: 'updated desc', status: 1 } })
    H.assert.equal(r.status, 200)
    const [[g]] = await pool.execute('SELECT description FROM games WHERE id=?', [gid])
    H.assert.equal(g.description, 'updated desc')
  })
  await test('编辑重名 → 400（新增修复：原 500）', async () => {
    const g2 = await mkGame(`tg2_${SEQ}`)
    const r = await http('PUT', `/games/${gid}`, { token: adminTok, body: { name: `tg2_${SEQ}` } })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '游戏名已存在')
  })
  await test('停用游戏后编辑不传 status → 保持停用（新增修复：原会误启用）', async () => {
    const g3 = await mkGame(`tg3_${SEQ}`)
    await pool.execute('UPDATE games SET status=0 WHERE id=?', [g3])
    const r = await http('PUT', `/games/${g3}`, { token: adminTok, body: { description: 'only desc' } })
    H.assert.equal(r.status, 200)
    const [[g]] = await pool.execute('SELECT status FROM games WHERE id=?', [g3])
    H.assert.equal(g.status, 0)
  })
  await test('PUT /games/sort 批量排序 → 200 生效', async () => {
    const r = await http('PUT', '/games/sort', { token: adminTok, body: [{ id: gid, sort_order: 1 }] })
    H.assert.equal(r.status, 200)
    const [[g]] = await pool.execute('SELECT sort_order FROM games WHERE id=?', [gid])
    H.assert.equal(g.sort_order, 1)
  })
  await test('sort 非法参数 → 400（新增校验）', async () => {
    const r = await http('PUT', '/games/sort', { token: adminTok, body: [{ id: 'abc', sort_order: 1 }] })
    H.assert.equal(r.status, 400)
  })
  await test('DELETE 有文章的游戏 → 400（RESTRICT）', async () => {
    const uid = await mkUser('restrict_owner')
    await mkPost(uid, { game_id: gid }) // 挂一篇文章到 gid，触发 RESTRICT
    const r = await http('DELETE', `/games/${gid}`, { token: adminTok })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '该游戏下已有文章，不可删除')
  })
  await test('DELETE 无文章游戏 → 200', async () => {
    const g4 = await mkGame(`tg4_${SEQ}`)
    const r = await http('DELETE', `/games/${g4}`, { token: adminTok })
    H.assert.equal(r.status, 200)
    const [[g]] = await pool.execute('SELECT COUNT(*) c FROM games WHERE id=?', [g4])
    H.assert.equal(g.c, 0)
    created.games = created.games.filter(x => x !== g4)
  })
  await test('GET /admin/games → 200 含停用游戏（D15）', async () => {
    const r = await http('GET', '/admin/games', { token: adminTok })
    H.assert.equal(r.status, 200)
    H.assert.ok(Array.isArray(r.data.data))
  })
}
