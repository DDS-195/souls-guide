// D23 操作日志：写（logOperation 中间件调用）+ 查（GET /admin/logs）
// 表结构见设计文档 3.14：无外键、只增不改（审计记录在用户删除后保留，admin_username 快照）
const pool = require('../config/db')

async function log({ admin_id, admin_username, action, method, path, target_type, target_id, detail, ip, status }) {
  await pool.execute(
    'INSERT INTO operation_logs (admin_id, admin_username, action, method, path, target_type, target_id, detail, ip, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [admin_id, admin_username, action, method, path, target_type, target_id, detail, ip, status]
  )
}

// 分页 + 筛选：admin_id（精确）/ action（精确）/ keyword（detail 模糊）/ start/end（YYYY-MM-DD，含当日）
async function findLogs({ page = 1, pageSize = 20, admin_id, action, keyword, start, end }) {
  const conds = []
  const params = []
  if (admin_id) { conds.push('admin_id = ?'); params.push(admin_id) }
  if (action) { conds.push('action = ?'); params.push(action) }
  if (keyword) { conds.push('detail LIKE ?'); params.push(`%${keyword}%`) }
  if (start) { conds.push('created_at >= ?'); params.push(start + ' 00:00:00') }
  if (end) { conds.push('created_at <= ?'); params.push(end + ' 23:59:59') }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
  const [rows] = await pool.execute(
    `SELECT * FROM operation_logs${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) as total FROM operation_logs${where}`, params)
  return { total, page, pageSize, list: rows }
}

module.exports = { log, findLogs }
