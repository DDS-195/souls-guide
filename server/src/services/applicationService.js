const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')

async function submit(userId, reason) {
  return withTransaction(async db => {
    const [[user]] = await db.execute('SELECT role,status,apply_status FROM users WHERE id=? FOR UPDATE', [userId])
    if (!user) return 'missing'
    if (user.status !== 1) return 'banned'
    if (user.role !== 'user') return 'role'
    if (user.apply_status === 'pending') return 'pending'
    const [result] = await db.execute('INSERT INTO creator_applications (user_id,reason,pending_user_id) VALUES (?,?,?)', [userId,reason,userId])
    await db.execute("UPDATE users SET apply_status='pending',apply_reason=? WHERE id=?", [reason,userId])
    return { id: result.insertId }
  })
}

async function latest(userId) {
  const [[row]] = await pool.execute('SELECT id,reason,status,submitted_at,reviewed_at,reject_reason,legacy FROM creator_applications WHERE user_id=? ORDER BY id DESC LIMIT 1', [userId])
  return row || null
}

async function list(page, pageSize, status) {
  const where = status === 'processed' ? "a.status<>'pending'" : "a.status='pending'"
  return withTransaction(async db => {
    const [rows] = await db.execute(`SELECT a.*,u.username,u.nickname,u.avatar,u.role,u.status AS user_status
      FROM creator_applications a JOIN users u ON u.id=a.user_id WHERE ${where}
      ORDER BY ${status === 'processed' ? 'a.id DESC' : 'a.submitted_at ASC,a.id ASC'} LIMIT ? OFFSET ?`, [String(pageSize),String((page-1)*pageSize)])
    const [[{total}]] = await db.execute(`SELECT COUNT(*) AS total FROM creator_applications a WHERE ${where}`)
    return { list: rows,total,page,pageSize }
  })
}

// 路径仍是用户 ID；请求必须携带申请 ID，旧页面不能审核到新一轮申请。
async function decide(userId, applicationId, actor, decision, reason) {
  return withTransaction(async db => {
    const [[user]] = await db.execute('SELECT role,status,apply_status FROM users WHERE id=? FOR UPDATE', [userId])
    if (!user) return 'missing'
    const [[application]] = await db.execute('SELECT status FROM creator_applications WHERE id=? AND user_id=? FOR UPDATE', [applicationId,userId])
    if (!application || application.status !== 'pending' || user.apply_status !== 'pending' || user.role !== 'user') return 'conflict'
    if (decision === 'approved' && user.status !== 1) return 'banned'
    await db.execute('UPDATE creator_applications SET status=?,pending_user_id=NULL,reviewed_at=NOW(),reviewer_id=?,reviewer_username=?,reject_reason=? WHERE id=?', [decision,actor.id,actor.username,reason,applicationId])
    await db.execute("UPDATE users SET apply_status=?,role=CASE WHEN ?='approved' THEN 'creator' ELSE role END WHERE id=?", [decision,decision,userId])
    await require('./notificationService').emit(db, userId, null,'audit','creatorship',applicationId,decision === 'approved' ? `你的创作者申请 #${applicationId} 已通过` : `你的创作者申请 #${applicationId} 被驳回：${reason}`)
    await require('../utils/auditContext').record(db, { application_id: applicationId, decision }, { event_key: 'application-review:' + applicationId })
    return 'ok'
  })
}
module.exports = { submit,latest,list,decide }
