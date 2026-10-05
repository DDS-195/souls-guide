// SoulsGuide 后端测试基架（2026-08-13，零依赖：node:assert + 全局 fetch + mysql2 + jsonwebtoken/bcrypt 均为项目已有依赖）
// 设计要点：
//   1. R2 合规——不引入任何测试框架，自实现微型 runner（test/summary）
//   2. 真实环境——直接打真实 MySQL 库 + 真实启动 server.js（端口 3199，不占用开发 3000）
//   3. 数据零残留——所有创建对象登记 created.*，cleanup() 统一回收（含磁盘文件）
//   4. 令牌直签——除登录用例外一律 jwt.sign 直造 token，避免限流计数干扰
const path = require('path')
const fs = require('fs')
const assert = require('assert')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const pool = require('../src/config/db')

const SERVER_ROOT = path.join(__dirname, '..')
const BASE = 'http://127.0.0.1:3199/api'

// ================= 微型测试 runner =================
const state = { passed: 0, failed: 0, failures: [] }

async function test(name, fn) {
  try {
    await fn()
    state.passed++
    console.log(`    ✔ ${name}`)
  } catch (e) {
    state.failed++
    state.failures.push({ name, err: e.message })
    console.log(`    ✘ ${name}`)
    console.log(`        → ${e.message}`)
  }
}

function summary() {
  console.log('\n' + '='.repeat(60))
  console.log(`汇总：${state.passed} PASS / ${state.failed} FAIL`)
  if (state.failures.length) {
    console.log('失败清单：')
    for (const f of state.failures) console.log(`  ✘ ${f.name}\n      ${f.err}`)
  }
  return state.failed === 0
}

// ================= HTTP 封装 =================
async function http(method, p, { token, body, raw, form, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } }
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (form) {
    opts.body = form // multipart：不手动设 Content-Type，fetch 自动带 boundary
  } else if (raw !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = raw
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(BASE + p, opts)
  let data = null
  try { data = await res.json() } catch { /* 非 JSON 响应 */ }
  return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) }
}

// 直签 token（绕开限流；auth 中间件会查库校验 status/role，安全性同真实登录）
function makeToken(id, username, role) {
  return jwt.sign({ id, username, role }, process.env.JWT_SECRET)
}

async function adminToken() {
  const [[row]] = await pool.execute("SELECT id, username, role FROM users WHERE username='admin'")
  return makeToken(row.id, row.username, row.role)
}

// ================= 数据工厂（全部登记，cleanup 回收）=================
const created = { users: [], posts: [], games: [], announcements: [], files: [], dirs: [] }
const SEQ = Date.now() % 100000 // 一次运行内稳定前缀，避免与历史残留撞唯一键

async function mkUser(username, { role = 'user', apply = 'none', password = 'test123' } = {}) {
  const name = `${username}_${SEQ}`
  const hashed = await bcrypt.hash(password, 4)
  await pool.execute('INSERT INTO users (username, password, role, apply_status) VALUES (?,?,?,?)', [name, hashed, role, apply])
  const [[u]] = await pool.execute('SELECT id FROM users WHERE username=?', [name])
  created.users.push(u.id)
  return u.id
}

async function mkPost(userId, { status = 'published', content = '<p>smoke content</p>', title = 'smoke', category = 'BOSS攻略', video = null, cover = null, game_id = 1 } = {}) {
  const [r] = await pool.execute(
    'INSERT INTO posts (title,content,cover,game_id,category,status,published_at,user_id) VALUES (?,?,?,?,?,?,IF(?=\'published\',NOW(),NULL),?)',
    [title, content, cover, game_id, category, status, status, userId]
  )
  created.posts.push(r.insertId)
  return r.insertId
}

async function mkGame(name) {
  const [r] = await pool.execute("INSERT INTO games (name, description, sort_order, status) VALUES (?,?,?,?)", [name, '', 0, 1])
  created.games.push(r.insertId)
  return r.insertId
}

async function registerAsset(ownerId, url, type, status = 'temporary') {
  await pool.execute(
    `INSERT INTO upload_assets (owner_id, url, type, status, expires_at)
     VALUES (?, ?, ?, ?, IF(?='temporary', DATE_ADD(NOW(), INTERVAL 1 DAY), NULL))
     ON DUPLICATE KEY UPDATE type=VALUES(type), status=VALUES(status), expires_at=VALUES(expires_at)`,
    [ownerId, url, type, status, status]
  )
  const [[asset]] = await pool.execute('SELECT id FROM upload_assets WHERE owner_id=? AND url=?', [ownerId, url])
  return asset.id
}

async function attachAsset(ownerId, postId, url, type, usageType, sortOrder = 0) {
  const assetId = await registerAsset(ownerId, url, type, 'attached')
  await pool.execute(
    'INSERT IGNORE INTO post_assets (post_id, asset_id, usage_type, sort_order) VALUES (?, ?, ?, ?)',
    [postId, assetId, usageType, sortOrder]
  )
  return assetId
}

// ================= 文件工具 =================
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function pngForm(name = 'smoke.png', type = 'image/png') {
  const f = new FormData()
  f.append('image', new File([PNG_1PX], name, { type }))
  return f
}

function urlToAbs(url) {
  return path.join(SERVER_ROOT, String(url).replace(/^\/+/, ''))
}

// 上传成功后登记磁盘文件，cleanup 统一 unlink（孤儿媒体文件零残留）
function trackFile(url) {
  if (url && typeof url === 'string' && url.startsWith('/uploads/')) created.files.push(urlToAbs(url))
  return url
}

function expectFile(url, exists = true) {
  const abs = urlToAbs(url)
  if (exists) assert.ok(fs.existsSync(abs), `磁盘文件应存在: ${url}`)
  else assert.ok(!fs.existsSync(abs), `磁盘文件应已删除: ${url}`)
}

// ================= 清理（零残留） =================
async function cleanup() {
  for (const id of created.posts) await pool.execute('DELETE FROM posts WHERE id=?', [id]).catch(() => {})
  for (const id of created.users) await pool.execute('DELETE FROM users WHERE id=?', [id]).catch(() => {})
  for (const id of created.games) await pool.execute('DELETE FROM games WHERE id=?', [id]).catch(() => {})
  for (const id of created.announcements) await pool.execute('DELETE FROM announcements WHERE id=?', [id]).catch(() => {})
  for (const f of created.files) { try { fs.unlinkSync(f) } catch { /* 已删除 */ } }
  for (const d of created.dirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 忽略 */ } }
}

module.exports = {
  test, summary, http, makeToken, adminToken,
  mkUser, mkPost, mkGame,
  registerAsset, attachAsset,
  PNG_1PX, pngForm, urlToAbs, trackFile, expectFile,
  created, cleanup, pool, SERVER_ROOT, SEQ, assert,
}
