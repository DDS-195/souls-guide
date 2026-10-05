const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')

// 待审列表只取队列字段，正文与媒体按需加载。
async function getPendingPosts(page = 1, pageSize = 10) {
  return withTransaction(async db => {
  const from = `FROM posts p JOIN users u ON p.user_id=u.id
    LEFT JOIN post_revisions r ON r.post_id=p.id AND p.status='published' AND r.status='pending'
    JOIN games g ON g.id=COALESCE(JSON_EXTRACT(r.payload,'$.game_id')+0,p.game_id)
    WHERE p.status='pending' OR r.post_id IS NOT NULL`
  const [rows] = await db.execute(
    `SELECT p.id, COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.title')),p.title) AS title,
      p.user_id, g.id AS game_id, COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.category')),p.category) AS category,
      'pending' AS status,p.content_version, COALESCE(r.submitted_at,p.submitted_at) AS submitted_at,
      p.created_at,u.username,g.name AS game_name, r.post_id IS NOT NULL AS is_revision
     ${from} ORDER BY COALESCE(r.submitted_at,p.submitted_at,p.created_at), p.id LIMIT ? OFFSET ?`,
    [String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total ${from}`)
  return { total, page, pageSize, list: rows }
  })
}

async function reviewSnapshot(db, id) {
  const [[post]] = await db.execute(
    'SELECT p.*, u.username, g.name AS game_name FROM posts p JOIN users u ON u.id=p.user_id JOIN games g ON g.id=p.game_id WHERE p.id=?', [id])
  if (!post) return null
  const [tags] = await db.execute('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=? ORDER BY t.id', [id])
  const [media] = await db.execute('SELECT * FROM media WHERE post_id=? ORDER BY sort_order,id', [id])
  let result = { ...post, guide_info: require('../utils/guideInfo').decodeGuideInfo(post.guide_info), tags: tags.map(t => t.name), media }
  if (post.status === 'published') {
    result = await require('./postRevisionService').decorateOn(db, result)
    if (result.is_revision) {
      const [[game]] = await db.execute('SELECT name FROM games WHERE id=?', [result.game_id])
      result.game_name = game?.name
    }
  }
  return result
}

async function getReviewDetail(id) {
  return withTransaction(async db => {
    // 与内容编辑使用同一行锁，保证正文、标签、媒体属于同一版本。
    const [[locked]] = await db.execute('SELECT id FROM posts WHERE id=? FOR UPDATE', [id])
    if (!locked) return null
    const post = await reviewSnapshot(db, id)
    const [reviews] = await db.execute(
      'SELECT id, content_version, reviewer_username, decision, reason, created_at FROM post_reviews WHERE post_id=? ORDER BY id DESC LIMIT 20', [id])
    return { ...post, reviews }
  })
}

async function decidePost(id, version, actor, decision, reason = null) {
  return withTransaction(async db => {
    const [[post]] = await db.execute('SELECT * FROM posts WHERE id=? FOR UPDATE', [id])
    if (!post) return null
    const revisions = require('./postRevisionService')
    const revision = post.status === 'published' ? await revisions.getOn(db, id) : null
    if ((revision ? revision.status : post.status) !== 'pending' || post.content_version !== version) return 'conflict'
    const snapshot = await reviewSnapshot(db, id)
    await db.execute(
      `INSERT INTO post_reviews (post_id, content_version, reviewer_id, reviewer_username, decision, reason, snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, version, actor.id, actor.username, decision, reason, JSON.stringify(snapshot)]
    )
    if (revision) {
      if (decision === 'published') await revisions.applyOn(db, post, revision)
      else await db.execute("UPDATE post_revisions SET status='rejected',reject_reason=? WHERE post_id=?", [reason,id])
    } else await db.execute(
      `UPDATE posts SET status=?, reject_reason=?,
       published_at=CASE WHEN ?='published' THEN COALESCE(published_at,NOW()) ELSE published_at END WHERE id=?`,
      [decision, reason, decision, id]
    )
    await require('./notificationService').emit(db, post.user_id, null, 'audit', 'post', id,
      decision === 'published' ? (revision ? '你的文章修订审核已通过' : '你的文章审核已通过') :
        `${revision ? '你的文章修订被驳回，原文章仍公开' : '你的文章审核被驳回'}：${reason}`)
    await require('../utils/auditContext').record(db, { content_version: version, decision, is_revision: !!revision }, { event_key: 'post-review:' + id + ':' + version })
    return { user_id: post.user_id }
  })
}
async function approvePost(id, version, actor) { return decidePost(id, version, actor, 'published') }
async function rejectPost(id, reason, version, actor) { return decidePost(id, version, actor, 'rejected', reason) }

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
  await withTransaction(async db => {
    await db.execute('UPDATE reports SET status=?, handler_id=?, handler_note=? WHERE id=?', [status, handler_id, handler_note, id])
    await require('../utils/auditContext').record(db, { resolution: status })
  })
}

// 用户管理逻辑集中于 userAdminService，禁止旧的状态反转与直接清理路径。

// 公告：draft 可修改；一旦发布即冻结。后续修订通过 clone 生成新草稿，避免改写用户已读过的发布版本。
const ANNOUNCEMENT_FIELDS = `a.id, a.title, a.content, a.author_id, a.status, a.version, a.source_id,
  a.published_at, a.archived_at, a.created_at, a.updated_at`

async function writeAnnouncementEvent(db, announcement, action, fromStatus, toStatus, actor) {
  const [event] = await db.execute(
    `INSERT INTO announcement_events
      (announcement_id, actor_id, actor_username, action, from_status, to_status, version, title_snapshot, content_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [announcement.id, actor.id || null, actor.username || 'unknown', action, fromStatus, toStatus,
      announcement.version, announcement.title, announcement.content]
  )
  await require('../utils/auditContext').record(db, { id: announcement.id, version: announcement.version, from_status: fromStatus, to_status: toStatus, announcement_event_id: event.insertId }, {
    action: action + '_announcement', target_id: announcement.id, event_key: 'announcement-event:' + event.insertId,
    detail: `公告 #${announcement.id}：${action}（${fromStatus || '无'} → ${toStatus || '已删除'}）`,
  })
}

async function getAnnouncements({ page = 1, pageSize = 20, status } = {}) {
  const where = ['a.deleted_at IS NULL']
  const params = []
  if (status) { where.push('a.status=?'); params.push(status) }
  const clause = `WHERE ${where.join(' AND ')}`
  const [rows] = await pool.execute(
    `SELECT ${ANNOUNCEMENT_FIELDS}, u.username AS author_username
     FROM announcements a JOIN users u ON u.id=a.author_id
     ${clause} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    [...params, String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM announcements a ${clause}`, params)
  return { total, page, pageSize, list: rows }
}

async function getLatestAnnouncement(userId = null) {
  const [rows] = await pool.execute(
    `SELECT ${ANNOUNCEMENT_FIELDS}, CASE WHEN ar.user_id IS NULL THEN 0 ELSE 1 END AS is_read
     FROM announcement_channels ac
     JOIN announcements a ON a.id=ac.current_announcement_id
     LEFT JOIN announcement_reads ar
       ON ar.announcement_id=a.id AND ar.version=a.version AND ar.user_id=?
     WHERE ac.channel='global' AND a.status='published' AND a.deleted_at IS NULL
     LIMIT 1`,
    [userId || 0]
  )
  return rows[0] || null
}

async function createAnnouncement({ title, content, author_id, actor }) {
  return withTransaction(async (db) => {
    const [result] = await db.execute(
      'INSERT INTO announcements (title, content, author_id) VALUES (?, ?, ?)',
      [title, content, author_id]
    )
    const announcement = { id: result.insertId, title, content, version: 1 }
    await writeAnnouncementEvent(db, announcement, 'create', null, 'draft', actor)
    return { id: result.insertId, version: 1 }
  })
}

async function updateAnnouncement(id, { title, content, version, actor }) {
  return withTransaction(async (db) => {
    const [[current]] = await db.execute(
      'SELECT id,title,content,status,version FROM announcements WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id]
    )
    if (!current) return null
    if (current.status !== 'draft') return 'not_editable'
    if (current.version !== version) return 'conflict'
    const next = { id: current.id, title, content, version: current.version + 1 }
    await db.execute('UPDATE announcements SET title=?, content=?, version=version+1 WHERE id=?', [title, content, id])
    await writeAnnouncementEvent(db, next, 'update', 'draft', 'draft', actor)
    return { version: next.version }
  })
}

async function cloneAnnouncement(id, { author_id, actor }) {
  return withTransaction(async (db) => {
    const [[source]] = await db.execute(
      'SELECT id,title,content,status FROM announcements WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id]
    )
    if (!source) return null
    const [result] = await db.execute(
      'INSERT INTO announcements (title,content,author_id,source_id) VALUES (?,?,?,?)',
      [source.title, source.content, author_id, source.id]
    )
    const announcement = { id: result.insertId, title: source.title, content: source.content, version: 1 }
    await writeAnnouncementEvent(db, announcement, 'clone', null, 'draft', actor)
    return { id: result.insertId, version: 1 }
  })
}

async function publishAnnouncement(id, actor) {
  return withTransaction(async (db) => {
    // 固定 global 行是统一锁入口；任何发布都按相同顺序取锁。
    const [[channel]] = await db.execute(
      "SELECT current_announcement_id FROM announcement_channels WHERE channel='global' FOR UPDATE"
    )
    const [[target]] = await db.execute(
      'SELECT id,title,content,status,version FROM announcements WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id]
    )
    if (!target) return null
    if (target.status !== 'draft') return 'not_publishable'

    if (channel && channel.current_announcement_id && channel.current_announcement_id !== target.id) {
      const [[previous]] = await db.execute(
        'SELECT id,title,content,status,version FROM announcements WHERE id=? FOR UPDATE',
        [channel.current_announcement_id]
      )
      if (previous && previous.status === 'published') {
        await db.execute("UPDATE announcements SET status='archived', archived_at=NOW() WHERE id=?", [previous.id])
        await writeAnnouncementEvent(db, previous, 'archive', 'published', 'archived', actor)
      }
    }

    await db.execute(
      "UPDATE announcements SET status='published', published_at=NOW(), archived_at=NULL WHERE id=?", [target.id]
    )
    await db.execute(
      "UPDATE announcement_channels SET current_announcement_id=? WHERE channel='global'", [target.id]
    )
    await writeAnnouncementEvent(db, target, 'publish', 'draft', 'published', actor)
    return { id: target.id, version: target.version }
  })
}

async function archiveAnnouncement(id, actor) {
  return withTransaction(async (db) => {
    const [[channel]] = await db.execute(
      "SELECT current_announcement_id FROM announcement_channels WHERE channel='global' FOR UPDATE"
    )
    const [[target]] = await db.execute(
      'SELECT id,title,content,status,version FROM announcements WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id]
    )
    if (!target) return null
    if (target.status !== 'published' || !channel || channel.current_announcement_id !== target.id) return 'not_published'
    await db.execute("UPDATE announcements SET status='archived', archived_at=NOW() WHERE id=?", [id])
    await db.execute("UPDATE announcement_channels SET current_announcement_id=NULL WHERE channel='global'")
    await writeAnnouncementEvent(db, target, 'archive', 'published', 'archived', actor)
    return { id: target.id }
  })
}

async function deleteAnnouncement(id, actor) {
  return withTransaction(async (db) => {
    const [[target]] = await db.execute(
      'SELECT id,title,content,status,version FROM announcements WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id]
    )
    if (!target) return null
    if (target.status !== 'draft') return 'not_deletable'
    await db.execute("UPDATE announcements SET status='deleted', deleted_at=NOW() WHERE id=?", [id])
    await writeAnnouncementEvent(db, target, 'delete', 'draft', 'deleted', actor)
    return { id: target.id }
  })
}

async function markAnnouncementRead(announcementId, version, userId) {
  const [[active]] = await pool.execute(
    `SELECT a.id FROM announcement_channels ac JOIN announcements a ON a.id=ac.current_announcement_id
     WHERE ac.channel='global' AND a.id=? AND a.version=? AND a.status='published'`,
    [announcementId, version]
  )
  if (!active) return false
  await pool.execute(
    `INSERT INTO announcement_reads (announcement_id,user_id,version) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE read_at=VALUES(read_at)`,
    [announcementId, userId, version]
  )
  return true
}

// 统计
async function getStats() {
  const [[{ totalUsers }]] = await pool.execute('SELECT COUNT(*) as totalUsers FROM users')
  const [[{ totalPosts }]] = await pool.execute('SELECT COUNT(*) as totalPosts FROM posts')
  const [[{ totalViews }]] = await pool.execute('SELECT SUM(view_count) as totalViews FROM posts')
  return { totalUsers, totalPosts, totalViews }
}

module.exports = {
  getPendingPosts, getReviewDetail, approvePost, rejectPost,
  getReports, resolveReport,
  getAnnouncements, getLatestAnnouncement, createAnnouncement, updateAnnouncement, cloneAnnouncement,
  publishAnnouncement, archiveAnnouncement, deleteAnnouncement, markAnnouncementRead,
  getStats,
}
