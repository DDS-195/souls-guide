const adminService = require('../services/adminService')
const gameService = require('../services/gameService')
const logService = require('../services/logService')
const response = require('../utils/response')

async function getPendingPosts(req, res) {
  const { page, pageSize } = req.query
  const result = await adminService.getPendingPosts(+page || 1, +pageSize || 10)
  response.paginated(res, result)
}
async function approvePost(req, res) {
  const result = await adminService.approvePost(req.params.id)
  if (result === null) return response.error(res, '文章不存在', 404, 404)
  if (result === 'not_pending') return response.error(res, '仅待审核文章可执行此操作', 400, 400)
  response.success(res, null, '审核通过')
}
async function rejectPost(req, res) {
  const reason = (req.body.reason || '').trim()
  if (!reason) return response.error(res, '驳回原因不能为空')
  if (reason.length > 200) return response.error(res, '驳回原因不能超过 200 字')
  const result = await adminService.rejectPost(req.params.id, reason)
  if (result === null) return response.error(res, '文章不存在', 404, 404)
  if (result === 'not_pending') return response.error(res, '仅待审核文章可执行此操作', 400, 400)
  response.success(res, null, '已驳回')
}
async function getApplications(req, res) {
  const { page, pageSize } = req.query
  const result = await adminService.getApplications(+page || 1, +pageSize || 10)
  response.paginated(res, result)
}
async function approveApplication(req, res) {
  const result = await adminService.approveApplication(req.params.id)
  if (result === null) return response.error(res, '用户不存在', 404, 404)
  if (result === 'not_user') return response.error(res, '该用户已是创作者或管理员', 400, 400)
  if (result === 'not_pending') return response.error(res, '该申请不在待审状态', 400, 400)
  response.success(res, null, '申请已通过')
}
async function rejectApplication(req, res) {
  const result = await adminService.rejectApplication(req.params.id)
  if (result === null) return response.error(res, '用户不存在', 404, 404)
  if (result === 'not_user') return response.error(res, '该用户已是创作者或管理员', 400, 400)
  if (result === 'not_pending') return response.error(res, '该申请不在待审状态', 400, 400)
  response.success(res, null, '已驳回')
}
async function getReports(req, res) {
  const { page, pageSize, status } = req.query
  const result = await adminService.getReports(+page || 1, +pageSize || 10, status)
  response.paginated(res, result)
}
const REPORT_STATUSES = ['pending', 'resolved', 'dismissed'] // reports.status ENUM（schema 3.7）
async function resolveReport(req, res) {
  const { status, handler_note } = req.body
  if (!REPORT_STATUSES.includes(status)) return response.error(res, '非法处理状态', 400, 400)
  if (handler_note && handler_note.length > 300) return response.error(res, '处理备注不能超过 300 字')
  await adminService.resolveReport(req.params.id, { status, handler_id: req.user.id, handler_note: handler_note || null })
  response.success(res, null, '处理完成')
}
async function getUserList(req, res) {
  const { page, pageSize, role, keyword } = req.query
  const result = await adminService.getUserList({ page: +page || 1, pageSize: +pageSize || 10, role, keyword })
  response.paginated(res, result)
}
async function toggleBan(req, res) {
  const newStatus = await adminService.toggleBan(req.params.id)
  if (newStatus === null) return response.error(res, '用户不存在', 404, 404)
  if (newStatus === 'admin') return response.error(res, '不能封禁管理员', 400, 400)
  response.success(res, null, newStatus === 0 ? '已封禁' : '已解封')
}

// DELETE /api/admin/users/:id —— 删除用户（硬删除，级联清理；自删在 controller 层拦截）
async function deleteUser(req, res) {
  if (+req.params.id === req.user.id) return response.error(res, '不能删除自己', 400, 400)
  const result = await adminService.deleteUser(+req.params.id)
  if (result === null) return response.error(res, '用户不存在', 404, 404)
  if (result === 'admin') return response.error(res, '不能删除管理员', 400, 400)
  if (result === 'has_announcements') return response.error(res, '该用户发布过公告，不能删除', 400, 400)
  response.success(res, result, '用户已删除')
}
async function getAnnouncements(req, res) {
  const list = await adminService.getAnnouncements()
  response.success(res, list)
}
async function createAnnouncement(req, res) {
  const { title, content } = req.body
  if (!title || !content) return response.error(res, '标题和内容不能为空')
  if (title.length > 200) return response.error(res, '公告标题不能超过 200 字')
  if (Buffer.byteLength(content, 'utf8') > 64000) return response.error(res, '公告内容过长（上限约 2 万字）')
  const id = await adminService.createAnnouncement({ title, content, author_id: req.user.id })
  response.success(res, { id }, '创建成功')
}
async function updateAnnouncement(req, res) {
  const { title, content } = req.body
  if (!title || !content) return response.error(res, '标题和内容不能为空')
  if (title.length > 200) return response.error(res, '公告标题不能超过 200 字')
  if (Buffer.byteLength(content, 'utf8') > 64000) return response.error(res, '公告内容过长（上限约 2 万字）')
  await adminService.updateAnnouncement(req.params.id, { title, content })
  response.success(res, null, '更新成功')
}
async function publishAnnouncement(req, res) {
  await adminService.publishAnnouncement(req.params.id)
  response.success(res, null, '已发布')
}
async function archiveAnnouncement(req, res) {
  await adminService.archiveAnnouncement(req.params.id)
  response.success(res, null, '已归档')
}
async function deleteAnnouncement(req, res) {
  await adminService.deleteAnnouncement(req.params.id)
  response.success(res, null, '已删除')
}
async function getStats(req, res) {
  const stats = await adminService.getStats()
  response.success(res, stats)
}

// POST /api/admin/notifications —— 系统通知（4.3：type=system；body: { content, target_user_id? }）
async function sendNotification(req, res) {
  const { content, target_user_id } = req.body
  if (!content) return response.error(res, '通知内容不能为空')
  if (content.length > 300) return response.error(res, '通知内容不能超过 300 字')
  const count = await adminService.sendSystemNotification({ content, target_user_id: target_user_id ? +target_user_id : null })
  if (count === null) return response.error(res, '目标用户不存在', 404, 404)
  response.success(res, { count }, '已发送')
}

// GET /api/admin/games —— 游戏管理列表（含停用，D15）
async function getGames(req, res) {
  const games = await gameService.findAllAdmin()
  response.success(res, games)
}

// GET /api/admin/logs —— 操作日志分页筛选（D23）
async function getLogs(req, res) {
  const { page, pageSize, admin_id, action, keyword, start, end } = req.query
  const result = await logService.findLogs({
    page: +page || 1,
    pageSize: Math.min(+pageSize || 20, 100),
    admin_id: admin_id ? +admin_id : undefined,
    action: action || undefined,
    keyword: keyword || undefined,
    start: start || undefined,
    end: end || undefined,
  })
  response.paginated(res, result)
}

module.exports = {
  getPendingPosts, approvePost, rejectPost, getApplications, approveApplication, rejectApplication,
  getReports, resolveReport, getUserList, toggleBan, deleteUser, getAnnouncements, createAnnouncement,
  updateAnnouncement, publishAnnouncement, archiveAnnouncement, deleteAnnouncement, getStats, getGames,
  sendNotification, getLogs,
}
