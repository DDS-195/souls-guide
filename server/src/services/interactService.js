const pool = require('../config/db')

// 点赞 Toggle；文章不存在返回 null（controller → 404）
// 2026-08-13 修复（P0-2）：INSERT-first 语义（设计文档 3.10 契约），并发双击不再 500
// A2 并发加固（2026-08-13）：事务内先 `SELECT ... FOR UPDATE` 锁文章行，再判存在/插删——
//   ① 同一文章的并发 toggle 在行锁上天然串行化，消除「无点赞行但计数 +1」窗口；
//   ② 统一锁顺序（先 posts 行、后 likes 行），消除并发事务交叉持锁导致的 ER_LOCK_DEADLOCK（实测复现）
async function toggleLike(userId, postId) {
  const [[post]] = await pool.execute('SELECT user_id FROM posts WHERE id=?', [postId])
  if (!post) return null
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 锁文章行：同一篇文章的点赞操作在此串行化（含计数与通知的一致性边界）
    await conn.execute('SELECT id FROM posts WHERE id=? FOR UPDATE', [postId])
    const [existing] = await conn.execute('SELECT id FROM likes WHERE user_id=? AND post_id=?', [userId, postId])
    if (existing.length) {
      // 已点赞 → 取消：删行 + 自减（同一事务原子）
      await conn.execute('DELETE FROM likes WHERE user_id=? AND post_id=?', [userId, postId])
      await conn.execute('UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id=?', [postId])
      await conn.commit()
      return false
    }
    await conn.execute('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId])
    await conn.execute('UPDATE posts SET like_count = like_count + 1 WHERE id=?', [postId])
    // 通知（自己给自己点赞不发）
    if (post.user_id !== userId) {
      await conn.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, ?, ?, ?, ?, ?)',
        [post.user_id, userId, 'like', 'post', postId, '赞了你的文章'])
    }
    await conn.commit()
    return true
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.release()
  }
}

// 收藏 Toggle；文章不存在返回 null（controller → 404）
// A2 并发加固（2026-08-13）：同 toggleLike——先 FOR UPDATE 锁文章行再判存在/插删，串行化消除死锁
async function toggleFavorite(userId, postId) {
  const [[post]] = await pool.execute('SELECT id FROM posts WHERE id=?', [postId])
  if (!post) return null
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute('SELECT id FROM posts WHERE id=? FOR UPDATE', [postId])
    const [existing] = await conn.execute('SELECT id FROM favorites WHERE user_id=? AND post_id=?', [userId, postId])
    if (existing.length) {
      await conn.execute('DELETE FROM favorites WHERE user_id=? AND post_id=?', [userId, postId])
      await conn.commit()
      return false
    }
    await conn.execute('INSERT INTO favorites (user_id, post_id) VALUES (?, ?)', [userId, postId])
    await conn.commit()
    return true
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.release()
  }
}

// 关注 Toggle；被关注用户不存在返回 null，关注自己返回 'self'（controller 区分 404/400）
// A2 并发加固（2026-08-13）：先 FOR UPDATE 锁被关注用户行，同一目标的关注操作串行化（消除死锁 + 通知一致）
async function toggleFollow(followerId, followingId) {
  if (followerId === followingId) return 'self'
  const [[target]] = await pool.execute('SELECT id FROM users WHERE id=?', [followingId])
  if (!target) return null
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [followingId])
    const [existing] = await conn.execute('SELECT id FROM follows WHERE follower_id=? AND following_id=?', [followerId, followingId])
    if (existing.length) {
      await conn.execute('DELETE FROM follows WHERE follower_id=? AND following_id=?', [followerId, followingId])
      await conn.commit()
      return false
    }
    await conn.execute('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [followerId, followingId])
    await conn.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, ?, ?, ?, ?, ?)',
      [followingId, followerId, 'follow', 'user', followerId, '关注了你'])
    await conn.commit()
    return true
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.release()
  }
}

// 评论；文章不存在返回 null（controller → 404）
async function addComment(userId, postId, content, parentId = null) {
  const [[post]] = await pool.execute('SELECT user_id FROM posts WHERE id=?', [postId])
  if (!post) return null
  const [result] = await pool.execute(
    'INSERT INTO comments (user_id, post_id, content, parent_id) VALUES (?, ?, ?, ?)',
    [userId, postId, content, parentId]
  )
  await pool.execute('UPDATE posts SET comment_count = comment_count + 1 WHERE id=?', [postId])
  // 通知
  if (post.user_id !== userId) {
    const preview = content.length > 50 ? content.slice(0, 50) + '...' : content
    await pool.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, ?, ?, ?, ?, ?)',
      [post.user_id, userId, 'comment', 'post', postId, preview])
  }
  return result.insertId
}

async function replyComment(userId, commentId, content) {
  const [[comment]] = await pool.execute('SELECT id, post_id, user_id FROM comments WHERE id=?', [commentId])
  if (!comment) return null
  const id = await addComment(userId, comment.post_id, content, commentId)
  if (comment.user_id !== userId) {
    const preview = content.length > 50 ? content.slice(0, 50) + '...' : content
    await pool.execute('INSERT INTO notifications (receiver_id, sender_id, type, target_type, target_id, content) VALUES (?, ?, ?, ?, ?, ?)',
      [comment.user_id, userId, 'reply', 'comment', commentId, preview])
  }
  return id
}

async function getComments(postId) {
  const [rows] = await pool.execute(
    'SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at ASC',
    [postId]
  )
  // 构建嵌套树
  const map = {}, roots = []
  rows.forEach(r => { r.replies = []; map[r.id] = r })
  rows.forEach(r => {
    if (r.parent_id) map[r.parent_id]?.replies.push(r)
    else roots.push(r)
  })
  return roots
}

// 先查后删：findComment 供 controller 做本人权限校验（auth+本人/admin），存在返回 null
async function findComment(commentId) {
  const [[comment]] = await pool.execute('SELECT id, post_id, user_id FROM comments WHERE id=?', [commentId])
  return comment || null
}

// 2026-08-13 修复（P0-3）：删除评论后计数拉平（设计文档 8.4「重算」方案）
// A1 并发加固（2026-08-13）：读-算-写合并为单条原子 UPDATE——子查询在语句内取当前真实行数，
// 并发删除两条评论时无论谁后写，最终计数都等于真实行数（旧实现 DELETE→SELECT→UPDATE 三条语句有丢更新窗口）
async function deleteComment(commentId, postId) {
  await pool.execute('DELETE FROM comments WHERE id=?', [commentId])
  await pool.execute('UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ?) WHERE id = ?', [postId, postId])
}

// 收藏列表
// 2026-08-13 修复（P2-1）：只返回 published 文章——收藏后被驳回/下架的文章不再出现（旧实现点击详情 404）
async function getFavorites(userId, { page = 1, pageSize = 10 }) {
  const [rows] = await pool.execute(
    "SELECT p.*, u.username, u.avatar FROM posts p JOIN favorites f ON p.id = f.post_id JOIN users u ON p.user_id = u.id WHERE f.user_id = ? AND p.status = 'published' ORDER BY f.created_at DESC LIMIT ? OFFSET ?",
    [userId, String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await pool.execute(
    "SELECT COUNT(*) as total FROM favorites f JOIN posts p ON p.id = f.post_id WHERE f.user_id=? AND p.status = 'published'",
    [userId]
  )
  return { total, page, pageSize, list: rows }
}

// 通知
async function getNotifications(userId, { page = 1, pageSize = 20 }) {
  const [rows] = await pool.execute(
    'SELECT n.*, u.username, u.nickname, u.avatar FROM notifications n LEFT JOIN users u ON n.sender_id = u.id WHERE n.receiver_id=? ORDER BY n.created_at DESC LIMIT ? OFFSET ?',
    [userId, String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM notifications WHERE receiver_id=?', [userId])
  const [[{ unread }]] = await pool.execute('SELECT COUNT(*) as unread FROM notifications WHERE receiver_id=? AND is_read=0', [userId])
  return { total, page, pageSize, unread, list: rows }
}

async function markRead(userId, id) {
  if (id) {
    await pool.execute('UPDATE notifications SET is_read=1 WHERE id=? AND receiver_id=?', [id, userId])
  } else {
    await pool.execute('UPDATE notifications SET is_read=1 WHERE receiver_id=?', [userId])
  }
}

// 提交举报（D21，2026-08-08）：target_type 白名单 post/user/comment（现阶段前端仅 post）；
// reason 为 `[类型] 原因` 明文存储（reports 表冻结不加列，不做解析）；目标不存在返回 null（controller → 400）
const REPORT_TYPES = ['post', 'user', 'comment']
const REPORT_TABLE = { post: 'posts', user: 'users', comment: 'comments' }
async function createReport(reporterId, { target_type, target_id, reason }) {
  const table = REPORT_TABLE[target_type]
  if (!table) return null
  const [[target]] = await pool.execute(`SELECT id FROM ${table} WHERE id=?`, [target_id])
  if (!target) return null
  const [result] = await pool.execute(
    'INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)',
    [reporterId, target_type, target_id, reason]
  )
  return result.insertId
}

// 粉丝列表（谁关注了我）
async function getFollowers(userId, { page = 1, pageSize = 10 }) {
  const [rows] = await pool.execute(
    'SELECT u.id, u.username, u.nickname, u.avatar, f.created_at AS followed_at FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT ? OFFSET ?',
    [userId, String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM follows WHERE following_id = ?', [userId])
  return { total, page, pageSize, list: rows }
}

// 关注列表（我关注了谁）
async function getFollowing(userId, { page = 1, pageSize = 10 }) {
  const [rows] = await pool.execute(
    'SELECT u.id, u.username, u.nickname, u.avatar, f.created_at AS followed_at FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT ? OFFSET ?',
    [userId, String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM follows WHERE follower_id = ?', [userId])
  return { total, page, pageSize, list: rows }
}

module.exports = { toggleLike, toggleFavorite, toggleFollow, addComment, replyComment, getComments, findComment, deleteComment, getFavorites, getNotifications, markRead, getFollowers, getFollowing, createReport }
