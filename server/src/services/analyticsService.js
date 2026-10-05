const crypto = require('crypto')
const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')

const POST_METRIC_COLUMNS = {
  like: 'likes_added',
  unlike: 'likes_removed',
  favorite: 'favorites_added',
  unfavorite: 'favorites_removed',
  comment: 'comments_added',
  comment_delete: 'comments_removed',
}

const BOT_UA = /bot|spider|crawler|slurp|headless|lighthouse|preview|facebookexternalhit|bingpreview/i

function hashVisitor(actorId, visitorId) {
  const source = actorId ? `user:${actorId}` : `guest:${visitorId}`
  const salt = process.env.ANALYTICS_SALT || process.env.JWT_SECRET || 'souls-guide-local-analytics'
  return crypto.createHash('sha256').update(`${salt}|${source}`).digest('hex')
}

function isLikelyBot(userAgent = '') {
  return BOT_UA.test(userAgent)
}

async function insertEvent(db, { eventType, postId = null, authorId, actorId = null, visitorKey = null, value = 1, internal = false }) {
  await db.execute(
    `INSERT INTO analytics_events
       (event_type, post_id, author_id, actor_id, visitor_key, event_value, is_internal)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [eventType, postId, authorId, actorId, visitorKey, value, internal ? 1 : 0]
  )
}

async function incrementDailyMetric(db, scopeType, scopeId, column, value = 1) {
  const allowed = new Set([
    'likes_added', 'likes_removed', 'favorites_added', 'favorites_removed',
    'comments_added', 'comments_removed', 'followers_added', 'followers_removed',
  ])
  if (!allowed.has(column)) throw new Error(`未知统计字段: ${column}`)
  await db.execute(
    `INSERT INTO analytics_daily_metrics (scope_type, scope_id, metric_date, ${column})
     VALUES (?, ?, CURDATE(), ?)
     ON DUPLICATE KEY UPDATE ${column}=${column}+VALUES(${column})`,
    [scopeType, scopeId, value]
  )
}

async function incrementDailyView(db, scopeType, scopeId, uvIncrement) {
  await db.execute(
    `INSERT INTO analytics_daily_metrics (scope_type, scope_id, metric_date, pv, uv)
     VALUES (?, ?, CURDATE(), 1, ?)
     ON DUPLICATE KEY UPDATE pv=pv+1, uv=uv+VALUES(uv)`,
    [scopeType, scopeId, uvIncrement]
  )
}

async function markDailyVisitor(db, scopeType, scopeId, visitorKey) {
  const [result] = await db.execute(
    `INSERT IGNORE INTO analytics_daily_visitors
       (scope_type, scope_id, metric_date, visitor_key)
     VALUES (?, ?, CURDATE(), ?)`,
    [scopeType, scopeId, visitorKey]
  )
  return result.affectedRows === 1 ? 1 : 0
}

// 互动关系表表达当前状态；这里额外写入不可变事件，才能计算新增、取消和净增长。
async function recordPostEvent(db, { eventType, post, actorId, value = 1 }) {
  const column = POST_METRIC_COLUMNS[eventType]
  if (!column) throw new Error(`未知文章事件: ${eventType}`)
  const internal = actorId === post.user_id
  await insertEvent(db, {
    eventType,
    postId: post.id,
    authorId: post.user_id,
    actorId,
    value,
    internal,
  })
  // 创作者自己的互动保留审计事实，但不计入业务表现。
  if (internal) return
  await incrementDailyMetric(db, 'post', post.id, column, value)
  await incrementDailyMetric(db, 'creator', post.user_id, column, value)
}

// 删除操作的执行者与被删评论的作者不是同一口径：管理员/作者可以删除包含
// 他人回复的子树。分开记录有效评论与作者自身/占位节点，actor_id 始终保留执行者。
async function recordCommentDeletion(db, { post, actorId, removed, effectiveRemoved }) {
  if (effectiveRemoved > 0) {
    await insertEvent(db, {
      eventType: 'comment_delete', postId: post.id, authorId: post.user_id,
      actorId, value: effectiveRemoved, internal: false,
    })
    await incrementDailyMetric(db, 'post', post.id, 'comments_removed', effectiveRemoved)
    await incrementDailyMetric(db, 'creator', post.user_id, 'comments_removed', effectiveRemoved)
  }
  const excluded = removed - effectiveRemoved
  if (excluded > 0) {
    await insertEvent(db, {
      eventType: 'comment_delete', postId: post.id, authorId: post.user_id,
      actorId, value: excluded, internal: true,
    })
  }
}

async function recordFollowEvent(db, { followingId, followerId, following }) {
  const eventType = following ? 'follow' : 'unfollow'
  const column = following ? 'followers_added' : 'followers_removed'
  await insertEvent(db, { eventType, authorId: followingId, actorId: followerId })
  await incrementDailyMetric(db, 'creator', followingId, column)
}

// 有效阅读：文章真实公开、非作者本人、非明显机器人；10 秒防重只消除重复上报，不替代周期 UV。
async function recordView({ postId, actorId = null, visitorId, userAgent = '' }) {
  const visitorKey = hashVisitor(actorId, visitorId)
  return withTransaction(async (db) => {
    const [[post]] = await db.execute(
      "SELECT id, user_id, view_count FROM posts WHERE id=? AND status='published' FOR UPDATE",
      [postId]
    )
    if (!post) return null
    if (actorId === post.user_id || isLikelyBot(userAgent)) {
      return { counted: false, view_count: post.view_count }
    }

    const [[session]] = await db.execute(
      `SELECT last_counted_at,
              last_counted_at <= DATE_SUB(NOW(), INTERVAL 10 SECOND) AS eligible
       FROM analytics_view_sessions
       WHERE post_id=? AND visitor_key=? FOR UPDATE`,
      [postId, visitorKey]
    )
    if (session && !session.eligible) return { counted: false, view_count: post.view_count }
    if (session) {
      await db.execute(
        'UPDATE analytics_view_sessions SET last_counted_at=NOW() WHERE post_id=? AND visitor_key=?',
        [postId, visitorKey]
      )
    } else {
      await db.execute(
        'INSERT INTO analytics_view_sessions (post_id, visitor_key, last_counted_at) VALUES (?, ?, NOW())',
        [postId, visitorKey]
      )
    }

    await insertEvent(db, {
      eventType: 'view',
      postId: post.id,
      authorId: post.user_id,
      actorId,
      visitorKey,
    })
    const postUv = await markDailyVisitor(db, 'post', post.id, visitorKey)
    const creatorUv = await markDailyVisitor(db, 'creator', post.user_id, visitorKey)
    await incrementDailyView(db, 'post', post.id, postUv)
    await incrementDailyView(db, 'creator', post.user_id, creatorUv)
    await db.execute('UPDATE posts SET view_count=view_count+1 WHERE id=?', [post.id])
    return { counted: true, view_count: post.view_count + 1 }
  })
}

module.exports = {
  hashVisitor,
  isLikelyBot,
  recordPostEvent,
  recordCommentDeletion,
  recordFollowEvent,
  recordView,
}
