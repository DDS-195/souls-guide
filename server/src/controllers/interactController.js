const interactService = require('../services/interactService')
const response = require('../utils/response')
const parsePagination = require('../utils/pagination')

async function like(req, res) {
  const liked = await interactService.toggleLike(req.user.id, +req.params.id)
  if (liked === null) return response.error(res, '文章不存在', 404, 404)
  response.success(res, liked)
}

async function favorite(req, res) {
  const result = await interactService.toggleFavorite(req.user.id, +req.params.id)
  if (result === null) return response.error(res, '文章不存在', 404, 404)
  response.success(res, result)
}

async function follow(req, res) {
  const result = await interactService.toggleFollow(req.user.id, +req.params.id)
  if (result === null) return response.error(res, '用户不存在', 404, 404)
  if (result === 'self') return response.error(res, '不能关注自己')
  response.success(res, { following: result })
}

async function getComments(req, res) {
  const options = parsePagination(req.query, { defaultPageSize: 20, maxPageSize: 50 })
  for (const key of ['parent_id', 'focus_id']) {
    if (req.query[key] !== undefined) {
      if (!/^[1-9]\d*$/.test(String(req.query[key])) || !Number.isSafeInteger(Number(req.query[key]))) return response.error(res, '评论编号无效')
      options[key] = Number(req.query[key])
    }
  }
  const result = await interactService.getComments(
    +req.params.postId,
    options
  )
  if (result === null) return response.error(res, '文章不存在', 404, 404)
  response.paginated(res, result)
}

async function addComment(req, res) {
  if (typeof req.body.content !== 'string' || !req.body.content.trim()) return response.error(res, '评论内容不能为空')
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
  if (typeof req.body.content !== 'string' || !req.body.content.trim()) return response.error(res, '回复内容不能为空')
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
  const commentCount = await interactService.deleteComment(comment.id, comment.post_id, req.user.id)
  response.success(res, { comment_count: commentCount }, '删除成功')
}

async function getFavorites(req, res) {
  const options = articleListOptions(req.query)
  if (!options) return response.error(res, '游戏编号无效')
  const result = await interactService.getFavorites(req.user.id, options)
  response.paginated(res, result)
}

function articleListOptions(query) {
  const { game_id } = query
  if (game_id !== undefined && (typeof game_id !== 'string' || !/^[1-9]\d*$/.test(game_id) || !Number.isSafeInteger(Number(game_id)))) return null
  return { ...parsePagination(query, { defaultPageSize:10, maxPageSize:50 }), game_id }
}

async function getFollowingFeed(req, res) {
  const options = articleListOptions(req.query)
  if (!options) return response.error(res, '游戏编号无效')
  const result = await require('../services/postService').findList({ ...options, following_user_id:req.user.id })
  response.paginated(res, result)
}

async function getNotifications(req, res) {
  if (req.query.unread !== undefined && !['0','1'].includes(req.query.unread)) return response.error(res, '未读筛选无效')
  const pagination = parsePagination(req.query, { defaultPageSize: 20 })
  const result = await interactService.getNotifications(req.user.id, {
    ...pagination,
    unreadOnly: req.query.unread === '1',
    type: req.query.type,
  })
  response.success(res, result)
}

async function markRead(req, res) {
  const result = await interactService.markRead(req.user.id, req.params.id || null, req.body?.cutoff_id, req.body?.type)
  response.success(res, result, 'ok')
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
  const result = await interactService.getFollowers(+req.params.id, parsePagination(req.query, { defaultPageSize: 10 }))
  response.paginated(res, result)
}

// GET /api/users/:id/following —— 关注列表（公开）
async function getFollowing(req, res) {
  const result = await interactService.getFollowing(+req.params.id, parsePagination(req.query, { defaultPageSize: 10 }))
  response.paginated(res, result)
}

module.exports = { like, favorite, follow, getComments, addComment, replyComment, deleteComment, getFavorites, getFollowingFeed, getNotifications, markRead, getFollowers, getFollowing, report }
