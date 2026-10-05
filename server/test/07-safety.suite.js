// 07 安全/边界：坏 JSON / 超大 body / token 篡改 / 角色实时生效（P2-3）/ 登录限流（P2-7，放最后）
const H = require('./helpers')

module.exports = async function safetySuite() {
  console.log('\n[07] 安全与边界')
  const { test, http, mkUser, mkPost, makeToken, adminToken, pool, SEQ } = H
  let adminTok = ''
  await adminToken().then(t => adminTok = t)

  await test('坏 JSON → 400 信封（P1-4 修复：原 500）', async () => {
    const r = await http('POST', '/users/login', { raw: '{bad json' })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.code, 400)
  })
  await test('body 超 1MB → 413 信封（P1-4 修复）', async () => {
    const r = await http('POST', '/users/login', { raw: JSON.stringify({ username: 'a', password: 'x'.repeat(1024 * 1024 + 10) }) })
    H.assert.equal(r.status, 413)
    H.assert.equal(r.data.code, 413)
  })
  await test('分页参数拒绝负数/非数字，并将 pageSize 限制在 50', async () => {
    const negative = await http('GET', '/posts?page=-1')
    H.assert.equal(negative.status, 400)
    H.assert.equal(negative.data.data, null)
    const invalid = await http('GET', '/posts?pageSize=abc')
    H.assert.equal(invalid.status, 400)
    const capped = await http('GET', '/posts?pageSize=999')
    H.assert.equal(capped.status, 200)
    H.assert.equal(capped.data.data.pageSize, 50)
  })
  await test('篡改 token → 401', async () => {
    const uid = await mkUser('stamper')
    const bad = makeToken(uid, 'stamper', 'user') + 'tampered'
    H.assert.equal((await http('GET', '/users/me', { token: bad })).status, 401)
  })
  await test('已删除用户的 token → 401（auth 查库校验）', async () => {
    const uid = await mkUser('sghost')
    const tok = makeToken(uid, 'sghost', 'user')
    await pool.execute('DELETE FROM users WHERE id=?', [uid])
    H.assert.equal((await http('GET', '/users/me', { token: tok })).status, 401)
    const idx = H.created.users.indexOf(uid)
    if (idx >= 0) H.created.users.splice(idx, 1)
  })
  await test('角色实时生效：审批通过后旧 token 直接可用创作接口（P2-3 修复）', async () => {
    const uid = await mkUser('srole')
    const oldTok = makeToken(uid, 'srole', 'user') // 旧角色 user 的 token
    // 审批前：403
    H.assert.equal((await http('POST', '/posts', { token: oldTok, body: { title: 'x', content: '<p>x</p>', game_id: 1, category: 'BOSS攻略' } })).status, 403)
    // 模拟申请 → admin 审批通过
    const application = await http('POST', '/users/apply-creator', { token: oldTok, body: { reason: '申请创作' } })
    H.assert.equal((await http('PUT', `/admin/applications/${uid}/approve`, { token: adminTok, body: { application_id: application.data.data.id } })).status, 200)
    // 审批后：同一旧 token 直接 200（auth 查库覆盖 token role，无需重新登录）
    const r = await http('POST', '/posts', { token: oldTok, body: { title: `实时角色_${SEQ}`, content: '<p>x</p>', game_id: 1, category: 'BOSS攻略' } })
    H.assert.equal(r.status, 200)
    H.created.posts.push(r.data.data.id)
    // 审批产生的审计记录手动清理（审计表无级联）
    await pool.execute('DELETE FROM operation_logs WHERE target_type=? AND target_id=?', ['user', uid])
  })
  await test('封禁用户的 token → 403（auth 查库校验）', async () => {
    const uid = await mkUser('sbanned')
    const tok = makeToken(uid, 'sbanned', 'user')
    await pool.execute('UPDATE users SET status=0 WHERE id=?', [uid])
    const r = await http('GET', '/users/me', { token: tok })
    H.assert.equal(r.status, 403)
    H.assert.equal(r.data.message, '账号已被封禁')
  })

  // ---- 登录限流（必须放最后：60s 窗口内 login+register 共享计数）----
  await test('登录暴力尝试 → 429 限流生效（P2-7）', async () => {
    let limited = false
    for (let i = 0; i < 30; i++) {
      const r = await http('POST', '/users/login', { body: { username: 'admin', password: 'wrong-' + i } })
      if (r.status === 429) {
        H.assert.equal(r.data.code, 429)
        limited = true
        break
      }
      H.assert.equal(r.status, 401)
    }
    H.assert.ok(limited, '30 次内应触发 429')
  })
}
