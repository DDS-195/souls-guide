const H = require('./helpers')
module.exports = async function () {
  const { test, assert, pool, http, mkUser, makeToken } = H
  await test('鉴权数据库故障交给错误处理器，不误判为登录失效', async () => {
    const auth = require('../src/middlewares/auth')
    const original = pool.execute
    const failure = new Error('test database outage')
    const req = () => ({headers:{authorization:`Bearer ${makeToken(1,'test','user')}`}})
    const res = { status() { throw new Error('数据库故障不应返回401') } }
    try {
      pool.execute = async () => { throw failure }
      for (const middleware of [auth, auth.authOptional]) {
        let received
        await middleware(req(),res,e=>{received=e})
        assert.equal(received,failure)
      }
    } finally { pool.execute = original }
  })
  const user = await mkUser('bodyvalidation',{role:'creator',apply:'approved'})
  const token = makeToken(user,'bodyvalidation','creator')
  await test('文章异常字段返回400，不创建数据也不触发500', async () => {
    const base = {title:'合法标题',content:'<p>正文</p>',game_id:1,category:'BOSS攻略'}
    for (const extra of [{title:123},{content:{}},{cover:{}},{video:[]},{tags:{}},{tags:[123]},{game_id:'1.2'}]) {
      assert.equal((await http('POST','/posts',{token,body:{...base,...extra}})).status,400)
    }
    const [[{n}]] = await pool.execute('SELECT COUNT(*) AS n FROM posts WHERE user_id=?',[user])
    assert.equal(n,0)
  })
}
