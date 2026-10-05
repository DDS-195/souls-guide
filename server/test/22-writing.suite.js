const H = require('./helpers')
module.exports = async function () {
  const { test, http, mkUser, makeToken, created, pool, assert } = H
  const id = await mkUser('writing', { role: 'creator', apply: 'approved' })
  const token = makeToken(id, 'writing', 'creator')
  const body = { title: '写作回归', content: '<p>正文</p>', game_id: 1, category: '新手入门' }
  const create = async tags => {
    const r = await http('POST', '/posts', { token, body: { ...body, tags } })
    if (r.status === 200) created.posts.push(r.data.data.id)
    return r
  }
  await test('标签30字可保存，31字返回400', async () => {
    assert.equal((await create(['标'.repeat(30)])).status, 200)
    assert.equal((await create(['标'.repeat(31)])).status, 400)
    assert.equal((await create(Array.from({ length: 21 }, (_, i) => String(i)))).status, 400)
  })
  await test('多篇文章并发创建同名新标签均成功且共享同一标签', async () => {
    const tag = `concurrent-${Date.now()}`
    const results = await Promise.all(Array.from({ length: 4 }, () => create([tag, tag])))
    assert.ok(results.every(r => r.status === 200), JSON.stringify(results.map(r => r.status)))
    const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM tags WHERE name=?', [tag])
    assert.equal(row.n, 1)
    const [links] = await pool.execute('SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE t.name=?', [tag])
    assert.equal(links.length, 4)
  })
  await test('并发重试同一创建编号仅创建一篇，不允许换内容或复活删除文章', async () => {
    const request_id = require('crypto').randomUUID()
    const results = await Promise.all(Array.from({ length: 4 }, () => http('POST', '/posts', { token, body: { ...body, request_id } })))
    assert.ok(results.every(r => r.status === 200))
    const ids = [...new Set(results.map(r => r.data.data.id))]
    assert.equal(ids.length, 1)
    const postId = ids[0]; created.posts.push(postId)
    assert.equal((await http('POST', '/posts', { token, body: { ...body, title: '不同内容', request_id } })).status, 409)
    assert.equal((await http('DELETE', `/posts/${postId}`, { token })).status, 200)
    assert.equal((await http('POST', '/posts', { token, body: { ...body, request_id } })).status, 409)
  })
  await test('编辑必须提供版本；并发保存一成功一冲突，旧版本不能覆盖', async () => {
    const result = await create([]); const postId = result.data.data.id
    assert.equal((await http('PUT', `/posts/${postId}`, { token, body: { title: '缺版本' } })).status, 400)
    const results = await Promise.all(['窗口A', '窗口B'].map(title => http('PUT', `/posts/${postId}`, { token, body: { title, content_version: 1 } })))
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
    const before = (await http('GET', `/posts/manage/${postId}`, { token })).data.data
    assert.equal(before.content_version, 2)
    assert.equal((await http('PUT', `/posts/${postId}`, { token, body: { title: '过期覆盖', content_version: 1 } })).status, 409)
    assert.equal((await http('GET', `/posts/manage/${postId}`, { token })).data.data.title, before.title)
  })
}
