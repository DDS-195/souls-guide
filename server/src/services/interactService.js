const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')
const analyticsService = require('./analyticsService')

// 点赞 Toggle；文章不存在返回 null（controller → 404）
// 2026-08-13 修复（P0-2）：INSERT-first 语义（设计文档 3.10 契约），并发双击不再 500
// A2 并发加固（2026-08-13）：事务内先 `SELECT ... FOR UPDATE` 锁文章行，再判存在/插删——
//   ① 同一文章的并发 toggle 在行锁上天然串行化，消除「无点赞行但计数 +1」窗口；
//   ② 统一锁顺序（先 posts 行、后 likes 行），消除并发事务交叉持锁导致的 ER_LOCK_DEADLOCK（实测复现）
async function toggleLike(userId, postId) {
  return withTransaction(async (conn) => {
    // 锁文章行：同一篇文章的点赞操作在此串行化（含计数与通知的一致性边界）
    const [[post]] = await conn.execute("SELECT id, user_id, like_count FROM posts WHERE id=? AND status='published' FOR UPDATE", [postId])
    if (!post) return null
    const [existing] = await conn.execute('SELECT id FROM likes WHERE user_id=? AND post_id=?', [userId, postId])
    if (existing.length) {
      // 已点赞 → 取消：删行 + 自减（同一事务原子）
      await conn.execute('DELETE FROM likes WHERE user_id=? AND post_id=?', [userId, postId])
      await conn.execute('UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id=?', [postId])
      await analyticsService.recordPostEvent(conn, { eventType: 'unlike', post, actorId: userId })
      return { liked: false, like_count: Math.max(0, post.like_count - 1) }
    }
    await conn.execute('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId])
    await conn.execute('UPDATE posts SET like_count = like_count + 1 WHERE id=?', [postId])
    await analyticsService.recordPostEvent(conn, { eventType: 'like', post, actorId: userId })
    // 通知（自己给自己点赞不发）
    if (post.user_id !== userId) {
      await require('./notificationService').emit(conn, post.user_id, userId, 'like', 'post', postId, '赞了你的文章')
    }
    return { liked: true, like_count: post.like_count + 1 }
  })
}

// 收藏 Toggle；文章不存在返回 null（controller → 404）
// A2 并发加固（2026-08-13）：同 toggleLike——先 FOR UPDATE 锁文章行再判存在/插删，串行化消除死锁
async function toggleFavorite(userId, postId) {
  return withTransaction(async (conn) => {
    const [[post]] = await conn.execute("SELECT id, user_id FROM posts WHERE id=? AND status='published' FOR UPDATE", [postId])
    if (!post) return null
    const [existing] = await conn.execute('SELECT id FROM favorites WHERE user_id=? AND post_id=?', [userId, postId])
    let favorited
    if (existing.length) {
      await conn.execute('DELETE FROM favorites WHERE user_id=? AND post_id=?', [userId, postId])
      favorited = false
    } else {
      await conn.execute('INSERT INTO favorites (user_id, post_id) VALUES (?, ?)', [userId, postId])
      favorited = true
    }
    await analyticsService.recordPostEvent(conn, {
      eventType: favorited ? 'favorite' : 'unfavorite',
      post,
      actorId: userId,
    })
    // 在同一篇文章的行锁内返回权威总数，前端无需用 +1/-1 猜测并发后的结果。
    const [[{ favorite_count }]] = await conn.execute('SELECT COUNT(*) AS favorite_count FROM favorites WHERE post_id=?', [postId])
    return { favorited, favorite_count }
  })
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
      await analyticsService.recordFollowEvent(conn, { followingId, followerId, following: false })
      await conn.commit()
      return false
    }
    await conn.execute('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [followerId, followingId])
    await analyticsService.recordFollowEvent(conn, { followingId, followerId, following: true })
    await require('./notificationService').emit(conn, followingId, followerId, 'follow', 'user', followerId, '关注了你')
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
  return withTransaction(async (db) => {
    const [[post]] = await db.execute("SELECT id, user_id FROM posts WHERE id=? AND status='published' FOR UPDATE", [postId])
    if (!post) return null
    if (parentId) {
      const [[parent]] = await db.execute('SELECT id FROM comments WHERE id=? AND post_id=?', [parentId, postId])
      if (!parent) return null
    }
    const [result] = await db.execute(
      'INSERT INTO comments (user_id, post_id, content, parent_id) VALUES (?, ?, ?, ?)',
      [userId, postId, content, parentId]
    )
    await db.execute('UPDATE posts SET comment_count = comment_count + 1 WHERE id=?', [postId])
    await analyticsService.recordPostEvent(db, { eventType: 'comment', post, actorId: userId })
    if (post.user_id !== userId) {
      const preview = content.length > 50 ? content.slice(0, 50) + '...' : content
      await require('./notificationService').emit(db, post.user_id, userId, 'comment', 'post', postId, preview, result.insertId)
    }
    return result.insertId
  })
}

async function replyComment(userId, commentId, content) {
  return withTransaction(async (db) => {
    const [[comment]] = await db.execute(
      `SELECT c.id, c.post_id, c.user_id, p.user_id AS post_author_id
       FROM comments c JOIN posts p ON p.id=c.post_id
       WHERE c.id=? AND p.status='published' FOR UPDATE`,
      [commentId]
    )
    if (!comment) return null
    const [result] = await db.execute(
      'INSERT INTO comments (user_id, post_id, content, parent_id) VALUES (?, ?, ?, ?)',
      [userId, comment.post_id, content, commentId]
    )
    await db.execute('UPDATE posts SET comment_count=comment_count+1 WHERE id=?', [comment.post_id])
    await analyticsService.recordPostEvent(db, {
      eventType: 'comment',
      post: { id: comment.post_id, user_id: comment.post_author_id },
      actorId: userId,
    })
    const preview = content.length > 50 ? content.slice(0, 50) + '...' : content
    if (comment.post_author_id !== userId && comment.post_author_id !== comment.user_id) {
      await require('./notificationService').emit(db, comment.post_author_id, userId, 'comment', 'post', comment.post_id, preview, result.insertId)
    }
    if (comment.user_id && comment.user_id !== userId) {
      await require('./notificationService').emit(db, comment.user_id, userId, 'reply', 'post', comment.post_id, preview, result.insertId)
    }
    return result.insertId
  })
}

// 每次只分页一个层级；根评论预览最多 3 条直接回复，禁止递归加载整棵树。
async function getComments(postId, { page = 1, pageSize = 20, parent_id = null, focus_id = null } = {}) {
  return withTransaction(async db => {
    const [[post]] = await db.execute("SELECT id FROM posts WHERE id=? AND status='published'", [postId])
    if (!post) return null
    if (parent_id) {
      const [[parent]] = await db.execute('SELECT id FROM comments WHERE id=? AND post_id=?', [parent_id, postId])
      if (!parent) return null
    }
    let path = []
    if (focus_id && !parent_id) {
        [path] = await db.execute(
          `WITH RECURSIVE ancestors AS (
             SELECT c.*, 0 AS depth FROM comments c WHERE id=? AND post_id=?
             UNION ALL
             SELECT c.*, a.depth+1 FROM comments c JOIN ancestors a ON c.id=a.parent_id
             WHERE c.post_id=? AND a.depth<63
           ) SELECT a.*,u.username,u.nickname,u.avatar,
             (SELECT COUNT(*) FROM comments child WHERE child.parent_id=a.id) AS reply_count
             FROM ancestors a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.depth DESC`,
          [focus_id, postId, postId])
      const root = path[0]
      if (root && root.parent_id === null) {
        const [[{ position }]] = await db.execute(
          'SELECT COUNT(*) AS position FROM comments WHERE post_id=? AND parent_id IS NULL AND (created_at>? OR (created_at=? AND id>?))',
          [postId, root.created_at, root.created_at, root.id])
        page = Math.floor(position / pageSize) + 1
      }
    }
    const filter = parent_id ? 'parent_id = ?' : 'parent_id IS NULL'
    const args = parent_id ? [postId, parent_id] : [postId]
    const [[{ total }]] = await db.execute('SELECT COUNT(*) AS total FROM comments WHERE post_id=? AND ' + filter, args)
    const order = parent_id ? 'ASC' : 'DESC'
    const [rows] = await db.execute(
      `SELECT c.*, u.username, u.nickname, u.avatar,
       (SELECT COUNT(*) FROM comments child WHERE child.parent_id=c.id) AS reply_count
       FROM comments c LEFT JOIN users u ON u.id=c.user_id
       WHERE c.post_id=? AND c.${filter}
       ORDER BY c.created_at ${order}, c.id ${order} LIMIT ? OFFSET ?`,
      [...args, String(pageSize), String((page-1)*pageSize)]
    )
    for (const row of rows) row.replies = []
    if (!parent_id && rows.length) {
      const ids = rows.map(r => r.id)
      const [preview] = await db.execute(
        `SELECT c.*, u.username, u.nickname, u.avatar,
         (SELECT COUNT(*) FROM comments child WHERE child.parent_id=c.id) AS reply_count
         FROM (
           ${ids.map(() => '(SELECT * FROM comments WHERE parent_id=? ORDER BY created_at,id LIMIT 3)').join(' UNION ALL ')}
         ) c LEFT JOIN users u ON u.id=c.user_id ORDER BY c.created_at,c.id`, ids)
      const roots = new Map(rows.map(r => [r.id, r]))
      for (const child of preview) {
        child.replies = []
        roots.get(child.parent_id).replies.push(child)
      }
      // 通知直达只补入目标的祖先链，不加载各层兄弟回复；最多 64 层。
      if (focus_id) {
        let current = path.length && roots.get(path[0].id)
        for (const node of path.slice(1)) {
          if (!current) break
          let child = current.replies.find(r => r.id === node.id)
          if (!child) {
            delete node.depth
            child = { ...node, replies: [] }
            current.replies.push(child)
            current.focus_path = true
          }
          current = child
        }
      }
    }
    return { total, page, pageSize, list: rows }
  })
}

// 先查后删：findComment 供 controller 做本人权限校验（auth+本人/admin），存在返回 null
async function findComment(commentId) {
  const [[comment]] = await pool.execute('SELECT id, post_id, user_id, is_deleted FROM comments WHERE id=?', [commentId])
  return comment || null
}

// 2026-08-13 修复（P0-3）：删除评论后计数拉平（设计文档 8.4「重算」方案）
// A1 并发加固（2026-08-13）：读-算-写合并为单条原子 UPDATE——子查询在语句内取当前真实行数，
// 并发删除两条评论时无论谁后写，最终计数都等于真实行数（旧实现 DELETE→SELECT→UPDATE 三条语句有丢更新窗口）
async function deleteComment(commentId, postId, actorId) {
  return withTransaction(async (db) => {
    const [[post]] = await db.execute('SELECT id, user_id FROM posts WHERE id=? FOR UPDATE', [postId])
    const [[node]] = await db.execute('SELECT is_deleted FROM comments WHERE id=? FOR UPDATE', [commentId])
    if (node?.is_deleted) throw Object.assign(new Error('已删除占位不可移除，以保留他人回复'), { statusCode: 409 })
    const [[{ removed, effective_removed }]] = await db.execute(
      `WITH RECURSIVE subtree AS (
         SELECT id,user_id,is_deleted FROM comments WHERE id=?
         UNION ALL
         SELECT c.id,c.user_id,c.is_deleted FROM comments c JOIN subtree s ON c.parent_id=s.id
       ) SELECT COUNT(*) AS removed,
         COALESCE(SUM(is_deleted=0 AND user_id IS NOT NULL AND user_id<>?),0) AS effective_removed
         FROM subtree`,
      [commentId, post?.user_id || null]
    )
    await db.execute('DELETE FROM comments WHERE id=?', [commentId])
    const [[{ count }]] = await db.execute('SELECT COUNT(*) AS count FROM comments WHERE post_id=?', [postId])
    await db.execute('UPDATE posts SET comment_count=? WHERE id=?', [count, postId])
    if (post && removed > 0) {
      await analyticsService.recordCommentDeletion(db, {
        post,
        actorId,
        removed: Number(removed),
        effectiveRemoved: Number(effective_removed),
      })
    }
    return count
  })
}

// 收藏列表
// 2026-08-13 修复（P2-1）：只返回 published 文章——收藏后被驳回/下架的文章不再出现（旧实现点击详情 404）
async function getFavorites(userId, options) {
  return require('./postService').findList({ ...options, favorites_user_id:userId })
}

// 通知
async function getNotifications(userId, options) { return require('./notificationService').list(userId, options) }
async function markRead(userId, id, cutoff, type) { return require('./notificationService').mark(userId, id, cutoff, type) }

// 提交举报（D21，2026-08-08）：target_type 白名单 post/user/comment（现阶段前端仅 post）；
// reason 为 `[类型] 原因` 明文存储（reports 表冻结不加列，不做解析）；目标不存在返回 null（controller → 400）
const REPORT_TYPES = ['post', 'user', 'comment']
const REPORT_TABLE = { post: 'posts', user: 'users', comment: 'comments' }
async function createReport(reporterId, { target_type, target_id, reason }) {
  const table = REPORT_TABLE[target_type]
  if (!table) return null
  let targetSql = `SELECT id FROM ${table} WHERE id=?`
  if (target_type === 'post') targetSql += " AND status='published'"
  if (target_type === 'comment') {
    targetSql = "SELECT c.id FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=? AND p.status='published'"
  }
  const [[target]] = await pool.execute(targetSql, [target_id])
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
