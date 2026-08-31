const pool = require('../config/db')
const mediaService = require('./mediaService')

// 待审核文章
async function getPendingPosts(page = 1, pageSize = 10) {
  const [rows] = await pool.execute(
    'SELECT p.*, u.username FROM posts p JOIN users u ON p.user_id = u.id WHERE p.status = ? ORDER BY p.created_at ASC LIMIT ? OFFSET ?',
    ['pending', String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM posts WHERE status=?', ['pending'])
  return { total, page, pageSize, list: rows }
}

// 审核通过：先查后改（2026-08-13 修复：不存在/非待审状态不再静默 200）
// 返回：null=文章不存在；'not_pending'=非待审状态（仅 pending 可审核，防 draft 绕过审核直发/已发布被打回）
async function approvePost(id) {
  const [[post]] = await pool.execute('SELECT user_id, title, status FROM posts WHERE id=?', [id])
  if (!post) return null
  if (post.status !== 'pending') return 'not_pending'
  await pool.execute("UPDATE posts SET status='published' WHERE id=?", [id])
  await pool.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, NULL, ?, ?, ?, ?)',
    [post.user_id, 'audit', 'post', id, '你的文章审核已通过'])
  return { user_id: post.user_id }
}

async function rejectPost(id, reason) {
  const [[post]] = await pool.execute('SELECT user_id, status FROM posts WHERE id=?', [id])
  if (!post) return null
  if (post.status !== 'pending') return 'not_pending'
  await pool.execute("UPDATE posts SET status='rejected', reject_reason=? WHERE id=?", [reason, id])
  await pool.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, NULL, ?, ?, ?, ?)',
    [post.user_id, 'audit', 'post', id, `你的文章审核被驳回：${reason}`])
  return { user_id: post.user_id }
}

// 创作者申请
async function getApplications(page = 1, pageSize = 10) {
  // 显式列（不返回 password 哈希）
  const [rows] = await pool.execute(
    'SELECT id, username, avatar, role, apply_status, apply_reason, bio, nickname, gender, birthday, status, created_at, updated_at FROM users WHERE apply_status = ? ORDER BY updated_at ASC LIMIT ? OFFSET ?',
    ['pending', String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM users WHERE apply_status=?', ['pending'])
  return { total, page, pageSize, list: rows }
}

// 通过创作者申请：先查后改（2026-08-13 修复：不存在 id 不再因通知外键 500；admin 不再可被降级）
// 返回：null=用户不存在；'not_user'=非普通用户（已是创作者/管理员，防 admin 被降级）；'not_pending'=不在待审状态
async function approveApplication(id) {
  const [[user]] = await pool.execute("SELECT id, role, apply_status FROM users WHERE id=?", [id])
  if (!user) return null
  if (user.role !== 'user') return 'not_user'
  if (user.apply_status !== 'pending') return 'not_pending'
  await pool.execute("UPDATE users SET role='creator', apply_status='approved' WHERE id=?", [id])
  await pool.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, NULL, ?, ?, ?, ?)',
    [id, 'audit', 'creatorship', id, '你的创作者申请已通过'])
  return { user_id: id }
}

// 驳回创作者申请：先查后改（2026-08-13 修复同上）
async function rejectApplication(id) {
  const [[user]] = await pool.execute("SELECT id, role, apply_status FROM users WHERE id=?", [id])
  if (!user) return null
  if (user.role !== 'user') return 'not_user'
  if (user.apply_status !== 'pending') return 'not_pending'
  await pool.execute("UPDATE users SET apply_status='rejected' WHERE id=?", [id])
  await pool.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, NULL, ?, ?, ?, ?)',
    [id, 'audit', 'creatorship', id, '你的创作者申请被驳回'])
  return { user_id: id }
}

// 举报
async function getReports(page = 1, pageSize = 10, status) {
  let sql = 'SELECT * FROM reports'
  const params = []
  if (status) { sql += ' WHERE status=?'; params.push(status) }
  sql += ' ORDER BY created_at ASC LIMIT ? OFFSET ?'
  params.push(String(pageSize), String((page - 1) * pageSize))
  const [rows] = await pool.execute(sql, params)
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM reports' + (status ? ' WHERE status=?' : ''), status ? [status] : [])
  return { total, page, pageSize, list: rows }
}

async function resolveReport(id, { status, handler_id, handler_note }) {
  await pool.execute('UPDATE reports SET status=?, handler_id=?, handler_note=? WHERE id=?', [status, handler_id, handler_note, id])
}

// 用户管理
async function getUserList({ page = 1, pageSize = 10, role, keyword }) {
  let sql = 'SELECT id, username, avatar, role, apply_status, status, created_at FROM users WHERE 1=1'
  const params = []
  if (role) { sql += ' AND role=?'; params.push(role) }
  if (keyword) { sql += ' AND username LIKE ?'; params.push(`%${keyword}%`) }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(String(pageSize), String((page - 1) * pageSize))
  const [rows] = await pool.execute(sql, params)
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM users WHERE 1=1' + (role ? ' AND role=?' : '') + (keyword ? ' AND username LIKE ?' : ''), [...(role ? [role] : []), ...(keyword ? [`%${keyword}%`] : [])])
  return { total, page, pageSize, list: rows }
}

// 封禁/解封；返回：null=用户不存在；'admin'=目标为管理员（禁止封禁，防锁死系统）；0/1=新状态
async function toggleBan(id) {
  const [[user]] = await pool.execute('SELECT status, role FROM users WHERE id=?', [id])
  if (!user) return null
  if (user.role === 'admin') return 'admin'
  const newStatus = user.status === 1 ? 0 : 1
  await pool.execute('UPDATE users SET status=? WHERE id=?', [newStatus, id])
  return newStatus
}

// 删除用户（硬删除，外键 CASCADE/SET NULL 自动级联）；返回：null=用户不存在；'admin'=目标为管理员；'has_announcements'=发布过公告（announcements.author_id RESTRICT）；成功={ deleted, username, post_count, comment_count }
// 2026-08-13：删除前收集磁盘文件 URL（头像 + 全部文章的 cover + media），行删除后统一 unlink，不再残留孤儿文件
async function deleteUser(id) {
  const [[user]] = await pool.execute('SELECT username, role, avatar FROM users WHERE id=?', [id])
  if (!user) return null
  if (user.role === 'admin') return 'admin'
  const [[{ ac }]] = await pool.execute('SELECT COUNT(*) as ac FROM announcements WHERE author_id=?', [id])
  if (ac > 0) return 'has_announcements'
  const [[{ post_count }]] = await pool.execute('SELECT COUNT(*) as post_count FROM posts WHERE user_id=?', [id])
  const [[{ comment_count }]] = await pool.execute('SELECT COUNT(*) as comment_count FROM comments WHERE user_id=?', [id])
  // 收集磁盘文件 URL（头像 + 文章封面 + 媒体库）
  const diskUrls = [user.avatar]
  const [posts] = await pool.execute('SELECT id, cover FROM posts WHERE user_id=?', [id])
  for (const p of posts) {
    if (p.cover) diskUrls.push(p.cover)
  }
  const postIds = posts.map(p => p.id)
  if (postIds.length) {
    const marks = postIds.map(() => '?').join(',')
    const [medias] = await pool.execute(`SELECT url FROM media WHERE post_id IN (${marks})`, postIds)
    for (const m of medias) diskUrls.push(m.url)
  }
  await pool.execute('DELETE FROM users WHERE id=?', [id])
  // 行删除成功后清理磁盘（unlink 失败仅忽略，不影响业务）
  await Promise.all(diskUrls.filter(Boolean).map(url => mediaService.unlinkUploads(url)))
  return { deleted: 1, username: user.username, post_count, comment_count }
}

// 公告
async function getAnnouncements() {
  const [rows] = await pool.execute('SELECT * FROM announcements ORDER BY created_at DESC')
  return rows
}

async function getLatestAnnouncement() {
  const [rows] = await pool.execute("SELECT * FROM announcements WHERE status='published' ORDER BY created_at DESC LIMIT 1")
  return rows[0] || null
}

async function createAnnouncement({ title, content, author_id }) {
  const [result] = await pool.execute('INSERT INTO announcements (title, content, author_id) VALUES (?, ?, ?)', [title, content, author_id])
  return result.insertId
}

async function updateAnnouncement(id, { title, content }) {
  await pool.execute('UPDATE announcements SET title=?, content=? WHERE id=?', [title, content, id])
}

async function publishAnnouncement(id) {
  await pool.execute("UPDATE announcements SET status='archived' WHERE status='published'")
  await pool.execute("UPDATE announcements SET status='published' WHERE id=?", [id])
}

async function archiveAnnouncement(id) {
  await pool.execute("UPDATE announcements SET status='archived' WHERE id=?", [id])
}
async function deleteAnnouncement(id) {
  await pool.execute('DELETE FROM announcements WHERE id=?', [id])
}

// 系统通知（4.3：sender_id=NULL → type=system；target_user_id 缺省时发给全部启用用户）
// 2026-08-13：定向目标先查存在性，无效 id 返回 null（controller → 400），不再撞外键 500
async function sendSystemNotification({ content, target_user_id }) {
  if (target_user_id) {
    const [[target]] = await pool.execute('SELECT id FROM users WHERE id=?', [target_user_id])
    if (!target) return null
    await pool.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, NULL, ?, ?, NULL, ?)',
      [target_user_id, 'system', 'system', content])
    return 1
  }
  const [result] = await pool.execute(
    "INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) SELECT id, NULL, ?, ?, NULL, ? FROM users WHERE status = 1",
    ['system', 'system', content]
  )
  return result.affectedRows
}

// 统计
async function getStats() {
  const [[{ totalUsers }]] = await pool.execute('SELECT COUNT(*) as totalUsers FROM users')
  const [[{ totalPosts }]] = await pool.execute('SELECT COUNT(*) as totalPosts FROM posts')
  const [[{ totalViews }]] = await pool.execute('SELECT SUM(view_count) as totalViews FROM posts')
  return { totalUsers, totalPosts, totalViews }
}

module.exports = { getPendingPosts, approvePost, rejectPost, getApplications, approveApplication, rejectApplication, getReports, resolveReport, getUserList, toggleBan, deleteUser, getAnnouncements, getLatestAnnouncement, createAnnouncement, updateAnnouncement, publishAnnouncement, archiveAnnouncement, deleteAnnouncement, sendSystemNotification, getStats }
