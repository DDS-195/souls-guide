// D23 操作日志：写（logOperation 中间件调用）+ 查（GET /admin/logs）
// 表结构见设计文档 3.14：无外键、只增不改（审计记录在用户删除后保留，admin_username 快照）
const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')

async function log({ admin_id, admin_username, action, method, path, target_type, target_id, detail, ip, status, request_id = null, event_key = null, metadata = null }, db = pool) {
  await db.execute(
    'INSERT INTO operation_logs (admin_id, admin_username, action, method, path, target_type, target_id, detail, ip, status, request_id, event_key, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [admin_id, admin_username, action, method, path, target_type, target_id, detail, ip, status, request_id, event_key, metadata ? JSON.stringify(metadata) : null]
  )
}

// 分页 + 筛选：admin_id（精确）/ action（精确）/ keyword（detail 模糊）/ start/end（YYYY-MM-DD，含当日）
async function findLogs({ page = 1, pageSize = 20, admin_id, action, keyword, start, end, request_id, target_type, target_id }) {
  const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
  for (const [key,value] of Object.entries({admin_id,target_id})) if (value !== undefined && (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1)) fail(key + ' 必须为正整数')
  for (const [key,value] of Object.entries({action,keyword,start,end,request_id,target_type})) if (value !== undefined && (typeof value !== 'string' || value.length > (key === 'keyword' ? 200 : 128))) fail(key + ' 格式无效或过长')
  for (const date of [start,end]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) fail('日期无效')
  if (start && end && start > end) fail('开始日期不能晚于结束日期')
  if (action && !['approve_post','reject_post','approve_application','reject_application','resolve_report','ban_user','unban_user','delete_user','create_announcement','update_announcement','clone_announcement','publish_announcement','archive_announcement','delete_announcement','send_notification','create_game','update_game','delete_game','sort_games'].includes(action)) fail('操作类型无效')
  if (target_type && !['post','user','report','announcement','notification','game'].includes(target_type)) fail('对象类型无效')
  const conds = []
  const params = []
  if (admin_id) { conds.push('admin_id = ?'); params.push(admin_id) }
  if (action) { conds.push('action = ?'); params.push(action) }
  if (keyword) { conds.push('LOCATE(?,detail)>0'); params.push(keyword) }
  if (request_id) { conds.push('request_id=?'); params.push(request_id) }
  if (target_type) { conds.push('target_type=?'); params.push(target_type) }
  if (target_id) { conds.push('target_id=?'); params.push(Number(target_id)) }
  if (start) { conds.push('created_at >= ?'); params.push(start + ' 00:00:00') }
  if (end) { conds.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(end) }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
  return withTransaction(async db => {
  const [rows] = await db.execute(
    `SELECT * FROM operation_logs${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, String(pageSize), String((page - 1) * pageSize)]
  )
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) as total FROM operation_logs${where}`, params)
  return { total, page, pageSize, list: rows }
  })
}

module.exports = { log, findLogs }
