const adminService = require('../services/adminService')
const gameService = require('../services/gameService')
const logService = require('../services/logService')
const response = require('../utils/response')
const parsePagination = require('../utils/pagination')

async function getPendingPosts(req, res) {
  const { page, pageSize } = parsePagination(req.query)
  const result = await adminService.getPendingPosts(page, pageSize)
  response.paginated(res, result)
}
function reviewId(req, res) {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id < 1) { response.error(res, '文章 ID 不合法', 400, 400); return null }
  return id
}
async function getReviewDetail(req, res) {
  const id = reviewId(req, res)
  if (!id) return
  const result = await adminService.getReviewDetail(id)
  if (!result) return response.error(res, '文章不存在', 404, 404)
  res.set('Cache-Control', 'no-store')
  response.success(res, result)
}
function reviewVersion(req, res) {
  const version = req.body?.content_version
  if (!Number.isSafeInteger(version) || version < 1) {
    response.error(res, '请提供有效的内容版本并重新打开审阅详情', 400, 400)
    return null
  }
  return version
}
async function approvePost(req, res) {
  const id = reviewId(req, res)
  if (!id) return
  const version = reviewVersion(req, res)
  if (!id || !version) return
  const result = await adminService.approvePost(id, version, req.user)
  if (result === null) return response.error(res, '文章不存在', 404, 404)
  if (result === 'conflict') return response.error(res, '内容或审核状态已变化，请重新审阅', 409, 409)
  response.success(res, null, '审核通过')
}
async function rejectPost(req, res) {
  const id = reviewId(req, res)
  if (!id) return
  const version = reviewVersion(req, res)
  if (!version) return
  if (typeof req.body.reason !== 'string') return response.error(res, '驳回原因必须为文本', 400, 400)
  const reason = req.body.reason.trim()
  if (!reason || reason.length > 200) return response.error(res, '驳回原因须为 1 至 200 字', 400, 400)
  const result = await adminService.rejectPost(id, reason, version, req.user)
  if (result === null) return response.error(res, '文章不存在', 404, 404)
  if (result === 'conflict') return response.error(res, '内容或审核状态已变化，请重新审阅', 409, 409)
  response.success(res, null, '已驳回')
}
async function getApplications(req, res) {
  const { page, pageSize } = parsePagination(req.query)
  const status = req.query.status || 'pending'
  if (!['pending','processed'].includes(status)) return response.error(res, '申请状态不合法')
  const result = await require('../services/applicationService').list(page, pageSize, status)
  response.paginated(res, result)
}
async function approveApplication(req, res) {
  return decideApplication(req, res, 'approved')
}
async function rejectApplication(req, res) {
  return decideApplication(req, res, 'rejected')
}
async function decideApplication(req, res, decision) {
  const id = Number(req.params.id)
  const applicationId = req.body?.application_id
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(applicationId) || applicationId < 1) return response.error(res, '请刷新列表后携带有效申请编号审核')
  const reason = decision === 'rejected' ? req.body?.reason : null
  if (decision === 'rejected' && (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500)) return response.error(res, '请填写 1–500 字的驳回原因')
  const result = await require('../services/applicationService').decide(id, applicationId, req.user, decision, reason?.trim() || null)
  if (result === 'missing') return response.error(res, '用户不存在', 404, 404)
  if (result === 'conflict') return response.error(res, '申请状态已变化，请刷新列表', 409, 409)
  if (result === 'banned') return response.error(res, '封禁账号不能通过申请', 409, 409)
  response.success(res, null, decision === 'approved' ? '申请已通过' : '已驳回')
}
async function getReports(req, res) {
  const { status } = req.query
  const { page, pageSize } = parsePagination(req.query)
  const result = await adminService.getReports(page, pageSize, status)
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
  const { role, keyword, status } = req.query
  const pagination = parsePagination(req.query)
  const result = await require('../services/userAdminService').list({ ...pagination, role, keyword, status })
  response.paginated(res, result)
}
async function toggleBan(req, res) {
  const service = require('../services/userAdminService')
  response.success(res, await service.setStatus(service.id(req.params.id), req.body, req.user))
}

// DELETE /api/admin/users/:id —— 删除用户（硬删除，级联清理；自删在 controller 层拦截）
async function deleteUser(req, res) {
  if (+req.params.id === req.user.id) return response.error(res, '不能删除自己', 400, 400)
  const service = require('../services/userAdminService')
  const result = await service.remove(service.id(req.params.id), req.body, req.user)
  response.success(res, result, '用户已删除')
}
async function previewUserDeletion(req, res) {
  const service = require('../services/userAdminService')
  response.success(res, await service.preview(service.id(req.params.id)))
}
const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived']

function announcementId(req, res) {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id < 1) {
    response.error(res, '公告不存在', 404, 404)
    return null
  }
  return id
}

function announcementInput(req, res, { requireVersion = false } = {}) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  if (typeof body.title !== 'string' || typeof body.content !== 'string') {
    response.error(res, '公告标题和内容必须为文本')
    return null
  }
  const title = body.title.trim()
  const content = body.content.trim()
  if (!title || !content) {
    response.error(res, '标题和内容不能为空')
    return null
  }
  if (Array.from(title).length > 200) {
    response.error(res, '公告标题不能超过 200 字')
    return null
  }
  if (Buffer.byteLength(content, 'utf8') > 64000) {
    response.error(res, '公告内容过长（UTF-8 不得超过 64000 字节）')
    return null
  }
  const version = Number(body.version)
  if (requireVersion && (!Number.isSafeInteger(version) || version < 1)) {
    response.error(res, '公告版本不合法')
    return null
  }
  return { title, content, version }
}

async function getAnnouncements(req, res) {
  const { page, pageSize } = parsePagination(req.query, { defaultPageSize: 20, maxPageSize: 50 })
  const status = req.query.status || undefined
  if (status && !ANNOUNCEMENT_STATUSES.includes(status)) return response.error(res, '公告状态不合法')
  const result = await adminService.getAnnouncements({ page, pageSize, status })
  response.paginated(res, result)
}
async function createAnnouncement(req, res) {
  const input = announcementInput(req, res)
  if (!input) return
  const result = await adminService.createAnnouncement({
    ...input, author_id: req.user.id, actor: req.user,
  })
  response.success(res, result, '创建成功')
}
async function updateAnnouncement(req, res) {
  const id = announcementId(req, res)
  if (!id) return
  const input = announcementInput(req, res, { requireVersion: true })
  if (!input) return
  const result = await adminService.updateAnnouncement(id, { ...input, actor: req.user })
  if (result === null) return response.error(res, '公告不存在', 404, 404)
  if (result === 'not_editable') return response.error(res, '已发布或已归档公告不可原地修改，请复制为新草稿', 409, 409)
  if (result === 'conflict') return response.error(res, '公告已被其他管理员修改，请刷新后重试', 409, 409)
  response.success(res, result, '更新成功')
}
async function cloneAnnouncement(req, res) {
  const id = announcementId(req, res)
  if (!id) return
  const result = await adminService.cloneAnnouncement(id, {
    author_id: req.user.id, actor: req.user,
  })
  if (!result) return response.error(res, '公告不存在', 404, 404)
  response.success(res, result, '已复制为新草稿')
}
async function publishAnnouncement(req, res) {
  const id = announcementId(req, res)
  if (!id) return
  const result = await adminService.publishAnnouncement(id, req.user)
  if (result === null) return response.error(res, '公告不存在', 404, 404)
  if (result === 'not_publishable') return response.error(res, '只有草稿可以发布', 409, 409)
  response.success(res, result, '已发布')
}
async function archiveAnnouncement(req, res) {
  const id = announcementId(req, res)
  if (!id) return
  const result = await adminService.archiveAnnouncement(id, req.user)
  if (result === null) return response.error(res, '公告不存在', 404, 404)
  if (result === 'not_published') return response.error(res, '只有当前生效公告可以归档', 409, 409)
  response.success(res, result, '已归档')
}
async function deleteAnnouncement(req, res) {
  const id = announcementId(req, res)
  if (!id) return
  const result = await adminService.deleteAnnouncement(id, req.user)
  if (result === null) return response.error(res, '公告不存在', 404, 404)
  if (result === 'not_deletable') return response.error(res, '只有未发布草稿可以删除；已发布内容请归档', 409, 409)
  response.success(res, result, '草稿已移入回收状态')
}
async function getStats(req, res) {
  const stats = await adminService.getStats()
  response.success(res, stats)
}

// POST /api/admin/notifications —— 系统通知（4.3：type=system；body: { content, target_user_id? }）
async function sendNotification(req, res) {
  const service = require('../services/notificationBroadcastService')
  response.success(res, await service.send(req.user, service.validate(req.body, true)), '已写入通知中心')
}

async function previewNotification(req, res) {
  const service = require('../services/notificationBroadcastService')
  response.success(res, await service.preview(service.validate(req.body)))
}

async function notificationHistory(req, res) {
  const service = require('../services/notificationBroadcastService')
  response.paginated(res, await service.history(parsePagination(req.query, { defaultPageSize: 10, maxPageSize: 50 })))
}

// GET /api/admin/games —— 游戏管理列表（含停用，D15）
async function getGames(req, res) {
  const games = await gameService.findAllAdmin()
  response.success(res, games)
}

// GET /api/admin/logs —— 操作日志分页筛选（D23）
async function getLogs(req, res) {
  const { admin_id, action, keyword, start, end, request_id, target_type, target_id } = req.query
  const pagination = parsePagination(req.query, { defaultPageSize: 20, maxPageSize: 100 })
  const result = await logService.findLogs({
    ...pagination,
    admin_id,
    request_id, target_type, target_id,
    action: action || undefined,
    keyword: keyword || undefined,
    start: start || undefined,
    end: end || undefined,
  })
  response.paginated(res, result)
}

module.exports = {
  getPendingPosts, getReviewDetail, approvePost, rejectPost, getApplications, approveApplication, rejectApplication,
  getReports, resolveReport, getUserList, toggleBan, deleteUser, getAnnouncements, createAnnouncement,
  updateAnnouncement, cloneAnnouncement, publishAnnouncement, archiveAnnouncement, deleteAnnouncement, getStats, getGames,
  sendNotification, previewNotification, notificationHistory, previewUserDeletion, getLogs,
}
