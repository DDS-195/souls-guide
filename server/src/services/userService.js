const pool = require('../config/db')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

async function findByUsername(username) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username])
  return rows[0]
}

async function findById(id) {
  // DATE 没有时区；以纯日期字符串返回，避免 JS Date 序列化成 UTC 后退到前一天。
  const [rows] = await pool.execute("SELECT id, username, nickname, avatar, bio, gender, DATE_FORMAT(birthday, '%Y-%m-%d') AS birthday, role, apply_status, status, created_at FROM users WHERE id = ?", [id])
  return rows[0]
}

async function findCredentialsById(id) {
  const [rows] = await pool.execute('SELECT id, password, role, token_version FROM users WHERE id = ?', [id])
  return rows[0]
}

async function create({ username, password }) {
  const [result] = await pool.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, password])
  return result.insertId
}

async function changePassword(id, password) {
  const [result] = await pool.execute(
    'UPDATE users SET password=?, token_version=token_version+1 WHERE id=?',
    [password, id]
  )
  return result.affectedRows
}

async function updateProfile(id, { nickname, bio, gender, birthday, avatar }) {
  const fields = []
  const params = []
  if (nickname !== undefined) { fields.push('nickname=?'); params.push(nickname) }
  if (bio !== undefined) { fields.push('bio=?'); params.push(bio) }
  if (gender !== undefined) { fields.push('gender=?'); params.push(gender) }
  if (birthday !== undefined) { fields.push('birthday=?'); params.push(birthday || null) }
  if (avatar !== undefined) { fields.push('avatar=?'); params.push(avatar) }
  if (!fields.length) return 0
  params.push(id)
  const [result] = await pool.execute(`UPDATE users SET ${fields.join(',')} WHERE id=?`, params)
  return result.affectedRows
}

// 计算文件内容 MD5（文件不存在返回 null）
function md5OfFile(filePath) {
  if (!fs.existsSync(filePath)) return null
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex')
}

// 磁盘绝对路径 → URL：相对 server 根（express.static('uploads') 的根），如 /uploads/images/2026/08/x.jpg
// （与 mediaController / videoService 的 toUrl 同款：file.destination 是绝对路径，不能直接拼进 URL）
function toUrl(absPath) {
  return '/' + path.relative(path.join(__dirname, '..', '..'), absPath).split(path.sep).join('/')
}

// 头像 URL（/uploads/xxx）→ 磁盘绝对路径（相对 server 根目录解析，不依赖 cwd）
function resolveAvatarPath(url) {
  return path.join(__dirname, '..', '..', url.replace(/^\/+/, ''))
}

/**
 * 上传头像：
 * 1. 若与当前头像内容一致（MD5 相同）→ 删除刚上传的重复文件，返回 { duplicate: true }，不写库
 * 2. 若为新头像 → 更新 users.avatar，随后删除旧头像文件（防孤儿文件堆积）
 */
async function uploadAvatar(userId, file) {
  const url = toUrl(file.path)
  const newHash = md5OfFile(file.path)
  const [[user]] = await pool.execute('SELECT avatar FROM users WHERE id = ?', [userId])

  if (user && user.avatar) {
    const oldHash = md5OfFile(resolveAvatarPath(user.avatar))
    if (oldHash && newHash && oldHash === newHash) {
      // 与当前头像重复：只做清理，不更新数据库
      try { await fs.promises.unlink(file.path) } catch (e) { console.error('删除重复头像失败:', e.message) }
      return { duplicate: true, url }
    }
  }

  // 新头像：先写库，成功后再删除旧头像文件
  await updateProfile(userId, { avatar: url })
  if (user && user.avatar) {
    try { await fs.promises.unlink(resolveAvatarPath(user.avatar)) } catch (e) { console.error('删除旧头像失败:', e.message) }
  }
  return { duplicate: false, url }
}

// 他人主页（4.1：文章数/粉丝数/关注数，不含密码等敏感字段）
// viewerId 存在（请求携带有效 token）时额外返回 is_followed（D19：当前用户是否已关注该用户）
// 2026-08-13 修复（P2-2）：post_count 只统计 published（对外可见口径，与创作者统计一致；旧实现含草稿/驳回虚高）
async function getProfile(id, viewerId) {
  const followsSub = viewerId
    ? ', (SELECT COUNT(*) FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id) AS is_followed'
    : ''
  const params = viewerId ? [viewerId, id] : [id]
  const [rows] = await pool.execute(
    `SELECT u.id, u.username, u.nickname, u.avatar, u.bio, u.role, u.created_at,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.status = 'published') AS post_count,
      (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
      (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count${followsSub}
     FROM users u WHERE u.id = ?`,
    params
  )
  const profile = rows[0]
  if (profile && profile.is_followed !== undefined) profile.is_followed = !!profile.is_followed
  return profile
}

module.exports = { findByUsername, findById, findCredentialsById, create, changePassword, updateProfile, uploadAvatar, getProfile }
