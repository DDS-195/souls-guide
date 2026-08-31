const interactService = require('../services/interactService')
const response = require('../utils/response')

async function like(req, res) {
  const liked = await interactService.toggleLike(req.user.id, +req.params.id)
  if (liked === null) return response.error(res, '文章不存在', 404, 404)
  response.success(res, { liked })
}

async function favorite(req, res) {
  const favorited = await interactService.toggleFavorite(req.user.id, +req.params.id)
  if (favorited === null) return response.error(res, '文章不存在', 404, 404)
  response.success(res, { favorited })
}

async function follow(req, res) {
  const result = await interactService.toggleFollow(req.user.id, +req.params.id)
  if (result === null) return response.error(res, '用户不存在', 404, 404)
  if (result === 'self') return response.error(res, '不能关注自己')
  response.success(res, { following: result })
}

async function getComments(req, res) {
  const comments = await interactService.getComments(+req.params.postId)
  response.success(res, comments)
}

async function addComment(req, res) {
  if (!req.body.content) return response.error(res, '评论内容不能为空')
  if (req.body.content.length > 2000) return response.error(res, '评论内容不能超过 2000 字')
  // 2026-08-13 修复（P1-5）：parent_id 必须存在且属于当前文章，防评论树错乱（挂到其他文章的评论下）
  const parentId = req.body.parent_id ? +req.body.parent_id : null
  if (parentId !== null) {
    if (!Number.isInteger(parentId) || parentId < 1) return response.error(res, '回复的评论不存在', 404, 404)
    const parent = await interactService.findComment(parentId)
    if (!parent) return response.error(res, '回复的评论不存在', 404, 404)
    if (parent.post_id !== +req.params.postId) return response.error(res, '回复的评论不属于该文章', 400, 400)
  }
  const id = await interactService.addComment(req.user.id, +req.params.postId, req.body.content, parentId)
  if (id === null) return response.error(res, '文章不存在', 404, 404)
  response.success(res, { id }, '评论成功')
}

async function replyComment(req, res) {
  if (!req.body.content) return response.error(res, '回复内容不能为空')
  if (req.body.content.length > 2000) return response.error(res, '回复内容不能超过 2000 字')
  const id = await interactService.replyComment(req.user.id, +req.params.commentId, req.body.content)
  if (id === null) return response.error(res, '原评论不存在', 404, 404)
  response.success(res, { id }, '回复成功')
}

async function deleteComment(req, res) {
  // auth+本人/admin（先查后删，避免越权删除）
  const comment = await interactService.findComment(+req.params.commentId)
  if (!comment) return response.error(res, '评论不存在', 404, 404)
  if (req.user.role !== 'admin' && comment.user_id !== req.user.id) {
    return response.error(res, '无权删除他人评论', 403, 403)
  }
  await interactService.deleteComment(comment.id, comment.post_id)
  response.success(res, null, '删除成功')
}

async function getFavorites(req, res) {
  const { page, pageSize } = req.query
  const result = await interactService.getFavorites(req.user.id, { page: +page || 1, pageSize: +pageSize || 10 })
  response.paginated(res, result)
}

async function getNotifications(req, res) {
  const { page, pageSize } = req.query
  const result = await interactService.getNotifications(req.user.id, { page: +page || 1, pageSize: +pageSize || 20 })
  response.success(res, result)
}

async function markRead(req, res) {
  await interactService.markRead(req.user.id, req.params.id || null)
  response.success(res, null, 'ok')
}

// GET /api/users/:id/followers —— 粉丝列表（公开）
// POST /api/reports —— 提交举报（D21，2026-08-08）：target_type 白名单 + reason 非空 ≤500；
// 目标存在性校验在 service（不存在 → 400）
const REPORT_TYPES = ['post', 'user', 'comment']
async function report(req, res) {
  const { target_type, target_id, reason } = req.body
  if (!REPORT_TYPES.includes(target_type)) return response.error(res, '举报类型不合法')
  if (!target_id) return response.error(res, '举报目标不能为空')
  if (!reason || !reason.trim()) return response.error(res, '举报原因不能为空')
  if (reason.length > 500) return response.error(res, '举报原因不能超过 500 字')
  const id = await interactService.createReport(req.user.id, { target_type, target_id: +target_id, reason })
  if (id === null) return response.error(res, '举报目标不存在')
  response.success(res, { id }, '举报已提交')
}

async function getFollowers(req, res) {
  const { page, pageSize } = req.query
  const result = await interactService.getFollowers(+req.params.id, { page: +page || 1, pageSize: +pageSize || 10 })
  response.paginated(res, result)
}

// GET /api/users/:id/following —— 关注列表（公开）
async function getFollowing(req, res) {
  const { page, pageSize } = req.query
  const result = await interactService.getFollowing(+req.params.id, { page: +page || 1, pageSize: +pageSize || 10 })
  response.paginated(res, result)
}

module.exports = { like, favorite, follow, getComments, addComment, replyComment, deleteComment, getFavorites, getNotifications, markRead, getFollowers, getFollowing, report }
