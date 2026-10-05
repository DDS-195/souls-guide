const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }

function validate(body, sending = false) {
  if (!body || !['all', 'user'].includes(body.scope)) fail('请选择明确的接收范围')
  const target = body.target_user_id
  if (body.scope === 'user' && (typeof target !== 'number' || !Number.isSafeInteger(target) || target < 1)) fail('目标用户 ID 必须为正整数')
  if (body.scope === 'all' && target != null) fail('群发不能同时指定用户')
  const data = { scope: body.scope, target_user_id: body.scope === 'user' ? target : null }
  if (sending) {
    if (typeof body.content !== 'string' || !body.content.trim()) fail('通知内容不能为空')
    data.content = body.content.trim()
    if (Array.from(data.content).length > 300) fail('通知内容不能超过 300 字')
    if (typeof body.request_id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(body.request_id)) fail('缺少有效的发送请求编号')
    data.request_id = body.request_id
  }
  return data
}

async function audience(db, data) {
  if (data.scope === 'all') {
    const [[{ count }]] = await db.execute('SELECT COUNT(*) AS count FROM users WHERE status=1')
    return { count, user: null }
  }
  const [[user]] = await db.execute('SELECT id,username,nickname,status FROM users WHERE id=?', [data.target_user_id])
  if (!user) fail('目标用户不存在', 404)
  if (user.status !== 1) fail('目标用户已封禁，不能接收系统通知', 409)
  return { count: 1, user }
}

async function send(actor, data) {
  return withTransaction(async db => {
    // 同一管理员串行：幂等查询和限频计数不会被并发请求绕过。
    const [[admin]] = await db.execute('SELECT role,status FROM users WHERE id=? FOR UPDATE', [actor.id])
    if (!admin || admin.role !== 'admin' || admin.status !== 1) fail('管理员权限已失效', 403)
    const [[existing]] = await db.execute('SELECT * FROM notification_batches WHERE admin_id=? AND request_id=?', [actor.id, data.request_id])
    if (existing) {
      if (existing.scope !== data.scope || existing.target_user_id !== data.target_user_id || existing.content !== data.content) fail('请求编号已用于其他内容，请重新确认发送', 409)
      require('../utils/auditContext').skip()
      return { id: existing.id, count: existing.recipient_count, replayed: true }
    }
    const [[{ n }]] = await db.execute('SELECT COUNT(*) AS n FROM notification_batches WHERE admin_id=? AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)', [actor.id])
    if (n >= 10) fail('发送过于频繁，请一分钟后重试', 429)
    const preview = await audience(db, data)
    const label = preview.user ? `${preview.user.nickname || preview.user.username} (@${preview.user.username})` : null
    const [batch] = await db.execute('INSERT INTO notification_batches (admin_id,admin_username,request_id,scope,target_user_id,target_label,content) VALUES (?,?,?,?,?,?,?)',
      [actor.id, actor.username, data.request_id, data.scope, data.target_user_id, label, data.content])
    // 单条 INSERT SELECT 与批次记录同事务；只给写入时仍启用的账号发送。
    const [result] = await db.execute(`INSERT INTO notifications (receiver_id,sender_id,type,target_type,target_id,content)
      SELECT id,NULL,'system','system',?,? FROM users WHERE status=1${data.scope === 'user' ? ' AND id=?' : ''}`,
      data.scope === 'user' ? [batch.insertId, data.content, data.target_user_id] : [batch.insertId, data.content])
    if (!result.affectedRows) fail('当前没有可接收通知的用户，请重新确认', 409)
    await db.execute('UPDATE notification_batches SET recipient_count=? WHERE id=?', [result.affectedRows, batch.insertId])
    await require('../utils/auditContext').record(db, { id: batch.insertId, count: result.affectedRows }, { event_key: 'notification-batch:' + batch.insertId })
    return { id: batch.insertId, count: result.affectedRows, replayed: false }
  })
}

async function history({ page, pageSize }) {
  return withTransaction(async db => {
    const [list] = await db.execute('SELECT * FROM notification_batches ORDER BY id DESC LIMIT ? OFFSET ?', [String(pageSize), String((page - 1) * pageSize)])
    const [[{ total }]] = await db.execute('SELECT COUNT(*) AS total FROM notification_batches')
    return { list, total, page, pageSize }
  })
}
module.exports = { validate, preview: data => audience(pool, data), send, history }
