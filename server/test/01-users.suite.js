// 01 用户模块：注册/登录/me/资料/头像/创作者申请/他人主页/时区/404 兜底
const H = require('./helpers')

module.exports = async function usersSuite() {
  console.log('\n[01] 用户模块 /api/users')
  const { test, http, mkUser, makeToken, trackFile, expectFile, urlToAbs, created, pool, SEQ } = H
  const uname = `tuser_${SEQ}`

  // ---- 注册 ----
  await test('注册成功返回 id', async () => {
    const r = await http('POST', '/users/register', { body: { username: uname, password: 'test123' } })
    H.assert.equal(r.status, 200)
    H.assert.equal(r.data.code, 0)
    H.assert.ok(r.data.data.id > 0)
    const [[u]] = await pool.execute('SELECT id FROM users WHERE username=?', [uname])
    H.assert.equal(u.id, r.data.data.id)
    created.users.push(u.id)
  })
  await test('重复用户名 → 409', async () => {
    const r = await http('POST', '/users/register', { body: { username: uname, password: 'test123' } })
    H.assert.equal(r.status, 409)
    H.assert.equal(r.data.message, '用户名已存在')
  })
  await test('缺 password → 400', async () => {
    const r = await http('POST', '/users/register', { body: { username: 'x_' + SEQ } })
    H.assert.equal(r.status, 400)
  })
  await test('用户名超 50 字 → 400（P1-1 修复）', async () => {
    const r = await http('POST', '/users/register', { body: { username: 'x'.repeat(51), password: 'test123' } })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '用户名不能超过 50 字符')
  })
  await test('密码少于 6 位 → 400', async () => {
    const r = await http('POST', '/users/register', { body: { username: 'short_' + SEQ, password: '123' } })
    H.assert.equal(r.status, 400)
  })
  await test('密码超 72 字 → 400（P1-1 修复）', async () => {
    const r = await http('POST', '/users/register', { body: { username: 'long_' + SEQ, password: 'x'.repeat(73) } })
    H.assert.equal(r.status, 400)
  })

  // ---- 登录 ----
  let loginToken = ''
  await test('登录成功返回 token/username/role', async () => {
    const r = await http('POST', '/users/login', { body: { username: uname, password: 'test123' } })
    H.assert.equal(r.status, 200)
    H.assert.equal(r.data.data.username, uname)
    H.assert.equal(r.data.data.role, 'user')
    H.assert.ok(r.data.data.token)
    loginToken = r.data.data.token
  })
  await test('密码错误 → 401 统一文案（P2-7 修复）', async () => {
    const r = await http('POST', '/users/login', { body: { username: uname, password: 'wrongpass' } })
    H.assert.equal(r.status, 401)
    H.assert.equal(r.data.message, '用户名或密码错误')
  })
  await test('不存在用户 → 401 同文案（P2-7 防枚举）', async () => {
    const r = await http('POST', '/users/login', { body: { username: 'nobody_' + SEQ, password: 'x' } })
    H.assert.equal(r.status, 401)
    H.assert.equal(r.data.message, '用户名或密码错误')
  })

  // ---- me ----
  await test('GET /me 无 token → 401', async () => {
    const r = await http('GET', '/users/me')
    H.assert.equal(r.status, 401)
  })
  let myId = null
  await test('GET /me → 200 含资料字段', async () => {
    const r = await http('GET', '/users/me', { token: loginToken })
    H.assert.equal(r.status, 200)
    H.assert.equal(r.data.data.username, uname)
    H.assert.ok('nickname' in r.data.data && 'gender' in r.data.data && 'birthday' in r.data.data)
    myId = r.data.data.id
  })
  await test('PUT /me 更新昵称 → 200', async () => {
    const r = await http('PUT', '/users/me', { token: loginToken, body: { nickname: '传火者', bio: '自我介绍', gender: '男', birthday: '2000-01-01' } })
    H.assert.equal(r.status, 200)
    const me = await http('GET', '/users/me', { token: loginToken })
    H.assert.equal(me.data.data.nickname, '传火者')
  })
  await test('昵称 <2 字 → 400', async () => {
    const r = await http('PUT', '/users/me', { token: loginToken, body: { nickname: 'a' } })
    H.assert.equal(r.status, 400)
  })
  await test('bio 超 200 字 → 400（P1-1 修复）', async () => {
    const r = await http('PUT', '/users/me', { token: loginToken, body: { bio: 'x'.repeat(201) } })
    H.assert.equal(r.status, 400)
  })

  // ---- 头像（含磁盘真实写入与去重）----
  let avatarUrl = null
  await test('上传头像 → 200 返回 url 且文件落盘', async () => {
    const r = await http('POST', '/users/me/avatar', { token: loginToken, form: H.pngForm('avatar.png') })
    H.assert.equal(r.status, 200)
    avatarUrl = trackFile(r.data.data.url)
    H.assert.ok(avatarUrl.startsWith('/uploads/images/'))
    expectFile(avatarUrl, true)
    const me = await http('GET', '/users/me', { token: loginToken })
    H.assert.equal(me.data.data.avatar, avatarUrl)
  })
  await test('重复上传相同头像 → 400（去重防堆积）', async () => {
    const r = await http('POST', '/users/me/avatar', { token: loginToken, form: H.pngForm('avatar.png') })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '与当前头像重复')
  })
  await test('非图片扩展名+非法 mimetype → 400（白名单兜底拒绝）', async () => {
    // 注意后端设计：mimetype 合法（image/png）直接放行不看扩展名；白名单兜底只在 mimetype 缺失/非法时生效
    const f = new FormData()
    f.append('image', new File([Buffer.from('MZFAKE_EXE')], 'evil.exe', { type: 'application/x-msdownload' }))
    const r = await http('POST', '/users/me/avatar', { token: loginToken, form: f })
    H.assert.equal(r.status, 400)
    H.assert.ok(r.data.message.includes('只允许上传'))
  })

  // ---- 创作者申请 ----
  await test('申请创作者 → 200 状态 pending', async () => {
    const r = await http('POST', '/users/apply-creator', { token: loginToken, body: { reason: '想做攻略' } })
    H.assert.equal(r.status, 200)
    const [[u]] = await pool.execute('SELECT apply_status, apply_reason FROM users WHERE id=?', [myId])
    H.assert.equal(u.apply_status, 'pending')
    H.assert.equal(u.apply_reason, '想做攻略')
  })
  await test('重复申请 → 400 申请审核中', async () => {
    const r = await http('POST', '/users/apply-creator', { token: loginToken, body: { reason: 'x' } })
    H.assert.equal(r.status, 400)
    H.assert.equal(r.data.message, '申请审核中，请耐心等待')
  })
  await test('申请理由超 500 字 → 400（P1-1 修复）', async () => {
    const uid = await mkUser('applylong')
    const t = makeToken(uid, 'applylong', 'user')
    const r = await http('POST', '/users/apply-creator', { token: t, body: { reason: 'x'.repeat(501) } })
    H.assert.equal(r.status, 400)
  })

  // ---- 他人主页 ----
  await test('GET /users/:id 公开 → 200 统计字段', async () => {
    const r = await http('GET', `/users/${myId}`)
    H.assert.equal(r.status, 200)
    H.assert.ok('post_count' in r.data.data && 'follower_count' in r.data.data && 'following_count' in r.data.data)
    H.assert.ok(!('password' in r.data.data))
    H.assert.ok(!('is_followed' in r.data.data)) // 游客不带该字段
  })
  await test('携带 token 访问 → 含 is_followed（D19）', async () => {
    const r = await http('GET', `/users/${myId}`, { token: loginToken })
    H.assert.equal(r.status, 200)
    H.assert.equal(typeof r.data.data.is_followed, 'boolean')
  })
  await test('不存在用户 → 404', async () => {
    const r = await http('GET', '/users/99999999')
    H.assert.equal(r.status, 404)
  })

  // ---- 时区（P2-4：DB 读写统一东八区）----
  await test('created_at 与本地时间差 < 5 分钟（P2-4 时区）', async () => {
    const [[u]] = await pool.execute('SELECT created_at FROM users WHERE id=?', [myId])
    const diff = Math.abs(new Date(u.created_at).getTime() - Date.now())
    H.assert.ok(diff < 5 * 60 * 1000, `时间差 ${diff}ms`)
  })

  // ---- 404 兜底 ----
  await test('未知 API → 404 信封「接口不存在」', async () => {
    const r = await http('GET', '/no-such-endpoint')
    H.assert.equal(r.status, 404)
    H.assert.equal(r.data.code, 404)
    H.assert.equal(r.data.message, '接口不存在')
  })
  await test('GET / 服务根 → 200 存活信封', async () => {
    const res = await fetch('http://127.0.0.1:3199/')
    const data = await res.json()
    H.assert.equal(res.status, 200)
    H.assert.equal(data.code, 0)
  })
}
