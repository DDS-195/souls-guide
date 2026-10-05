const H = require('./helpers')
module.exports = async function () {
  const { test, assert, pool, mkUser, mkPost, http } = H
  const user = await mkUser('replypages')
  const post = await mkPost(user)
  const insert = async parent => {
    const [r] = await pool.execute('INSERT INTO comments(post_id,user_id,content,parent_id) VALUES (?,?,?,?)', [post,user,'分页测试',parent])
    return r.insertId
  }
  const root = await insert(null)
  const children = []
  for (let i=0;i<25;i++) children.push(await insert(root))
  const deep = await insert(children[24])
  await test('根评论仅预览三条，楼中楼分页不重复且不递归返回', async () => {
    const initial = (await http('GET', `/posts/${post}/comments`)).data.data.list[0]
    assert.equal(initial.reply_count,25)
    assert.equal(initial.replies.length,3)
    const ids = []
    for (let page=1;page<=3;page++) {
      const result = (await http('GET', `/posts/${post}/comments?parent_id=${root}&pageSize=10&page=${page}`)).data.data
      assert.equal(result.total,25)
      assert.ok(result.list.length<=10)
      assert.ok(result.list.every(c=>c.replies.length===0))
      ids.push(...result.list.map(c=>c.id))
    }
    assert.deepEqual(ids,children)
  })
  await test('通知目标在预览之外时补入祖先链且保留回复计数', async () => {
    const list = (await http('GET', `/posts/${post}/comments?focus_id=${deep}`)).data.data.list
    const parent = list[0].replies.find(c=>c.id===children[24])
    assert.ok(parent)
    assert.equal(parent.replies[0].id,deep)
    assert.equal(list[0].reply_count,25)
    assert.ok(list[0].focus_path)
    assert.equal((await http('GET', `/posts/${post}/comments?parent_id=abc`)).status,400)
    const other = await mkPost(user)
    assert.equal((await http('GET', `/posts/${other}/comments?parent_id=${root}`)).status,404)
  })
  await test('通知旧页码自动修正，普通分页不被定位参数影响', async () => {
    for (let i=0;i<21;i++) await insert(null)
    const located = (await http('GET', `/posts/${post}/comments?page=1&focus_id=${deep}`)).data.data
    assert.equal(located.page,2)
    assert.ok(located.list.some(c=>c.id===root))
    const normal = (await http('GET', `/posts/${post}/comments?page=1`)).data.data
    assert.equal(normal.page,1)
    assert.ok(!normal.list.some(c=>c.id===root))
  })
  await test('评论及回复拒绝空白和非字符串内容', async () => {
    const token = H.makeToken(user, 'replypages', 'user')
    for (const content of ['   ', {}, 123]) {
      assert.equal((await http('POST', `/posts/${post}/comments`, {token,body:{content}})).status,400)
      assert.equal((await http('POST', `/comments/${root}/reply`, {token,body:{content}})).status,400)
    }
  })
}
