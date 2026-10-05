const withTransaction = require('../utils/withTransaction')
const { createHash } = require('crypto')
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
function id(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail('用户 ID 无效'); return n }
function reason(body) {
  if (typeof body?.reason !== 'string' || !body.reason.trim() || Array.from(body.reason.trim()).length > 300) fail('请填写 1～300 字操作原因')
  return body.reason.trim()
}
async function target(db, uid) {
  const [[u]] = await db.execute('SELECT id,username,role,status,management_version,avatar FROM users WHERE id=? FOR UPDATE', [uid])
  if (!u) fail('用户不存在', 404)
  if (u.role === 'admin') fail('不能操作管理员账号')
  return u
}
async function event(db, actor, u, action, why, detail) {
  const [event] = await db.execute('INSERT INTO user_management_events (actor_id,actor_username,user_id,username,action,reason,detail) VALUES (?,?,?,?,?,?,?)',
    [actor.id, actor.username, u.id, u.username, action, why, JSON.stringify(detail)])
  await require('../utils/auditContext').record(db, { ...detail, comment_count: detail.removed_comment_count, username: u.username, status: detail.to, user_event_id: event.insertId }, { event_key: 'user-event:' + event.insertId })
}
async function list({ page, pageSize, role, keyword, status }) {
  if (role && !['user', 'creator', 'admin'].includes(role)) fail('角色筛选无效')
  if (status !== undefined && !['0', '1'].includes(String(status))) fail('状态筛选无效')
  if (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 100)) fail('搜索词过长或格式错误')
  const where = ['1=1'], values = []
  if (role) { where.push('role=?'); values.push(role) }
  if (status !== undefined) { where.push('status=?'); values.push(Number(status)) }
  if (keyword?.trim()) {
    where.push('(LOCATE(?,username)>0 OR LOCATE(?,COALESCE(nickname,\'\'))>0 OR CAST(id AS CHAR)=?)')
    values.push(keyword.trim(), keyword.trim(), keyword.trim())
  }
  return withTransaction(async db => {
    const clause = where.join(' AND ')
    const [rows] = await db.execute(`SELECT id,username,nickname,avatar,role,apply_status,status,management_version,created_at FROM users WHERE ${clause} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`, [...values, String(pageSize), String((page - 1) * pageSize)])
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM users WHERE ${clause}`, values)
    return { list: rows, total, page, pageSize }
  })
}
async function setStatus(uid, body, actor) {
  const why = reason(body)
  if (![0, 1].includes(body.status) || !Number.isInteger(body.version)) fail('必须提交目标状态和版本')
  return withTransaction(async db => {
    const u = await target(db, uid)
    if (u.management_version !== body.version) fail('用户状态已变化，请刷新后重新确认', 409)
    if (u.status !== body.status) {
      await db.execute('UPDATE users SET status=?,management_version=management_version+1,token_version=token_version+? WHERE id=?', [body.status, body.status === 0 ? 1 : 0, uid])
      await event(db, actor, u, body.status === 0 ? 'ban' : 'unban', why, { from: u.status, to: body.status })
    } else require('../utils/auditContext').skip()
    return { status: body.status, version: u.management_version + (u.status !== body.status ? 1 : 0) }
  })
}
async function impact(db, u) {
  const [[counts]] = await db.execute(`SELECT
    (SELECT COUNT(*) FROM posts WHERE user_id=?) AS post_count,
    (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=?) AS removed_comment_count,
    (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.user_id=? AND p.user_id<>?) AS retained_comment_count,
    (SELECT COUNT(*) FROM upload_assets WHERE owner_id=?) AS asset_count,
    (SELECT COUNT(*) FROM announcements WHERE author_id=?) AS announcement_count`, [u.id,u.id,u.id,u.id,u.id,u.id])
  const fingerprint = createHash('sha256').update(JSON.stringify([u.id,u.username,u.management_version,counts])).digest('hex')
  return { ...counts, username: u.username, version: u.management_version, fingerprint }
}
async function preview(uid) { return withTransaction(async db => impact(db, await target(db, uid))) }
async function remove(uid, body, actor) {
  const why = reason(body)
  return withTransaction(async db => {
    const u = await target(db, uid)
    await db.execute(`SELECT id FROM posts WHERE user_id=? OR id IN (SELECT post_id FROM comments WHERE user_id=?)
      OR id IN (SELECT post_id FROM likes WHERE user_id=?) ORDER BY id FOR UPDATE`, [uid,uid,uid])
    const info = await impact(db, u)
    if (info.announcement_count) fail('该用户发布过公告，不能删除')
    if (body.username !== u.username || body.fingerprint !== info.fingerprint) fail('删除确认或影响范围已变化，请重新预览', 409)
    const [affected] = await db.execute('SELECT post_id FROM likes WHERE user_id=? UNION SELECT post_id FROM comments WHERE user_id=?', [uid,uid])
    const [assets] = await db.execute('SELECT url FROM upload_assets WHERE owner_id=?', [uid])
    const [covers] = await db.execute('SELECT cover AS url FROM posts WHERE user_id=?', [uid])
    const [media] = await db.execute('SELECT m.url FROM media m JOIN posts p ON p.id=m.post_id WHERE p.user_id=?', [uid])
    const urls = [...assets,...covers,...media,{url:u.avatar}]
    for (const { url } of urls) if (typeof url === 'string' && url.startsWith('/uploads/')) await db.execute('INSERT IGNORE INTO user_asset_cleanup (url) VALUES (?)', [url])
    // 清除正文与身份，但保留节点和 parent_id；其文章下的整棵评论树仍随文章删除。
    await db.execute("UPDATE comments SET content='[该评论已删除]',is_deleted=1,user_id=NULL WHERE user_id=?", [uid])
    await event(db, actor, u, 'delete', why, info)
    await db.execute('DELETE FROM users WHERE id=?', [uid])
    for (const row of affected) await db.execute(`UPDATE posts SET like_count=(SELECT COUNT(*) FROM likes WHERE post_id=?),
      comment_count=(SELECT COUNT(*) FROM comments WHERE post_id=?) WHERE id=?`, [row.post_id,row.post_id,row.post_id])
    return { deleted: 1, ...info, comment_count: info.removed_comment_count }
  })
}
module.exports = { id, list, setStatus, preview, remove }
