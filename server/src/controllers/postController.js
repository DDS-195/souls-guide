const postService = require('../services/postService')
const gameService = require('../services/gameService')
const response = require('../utils/response')
const parsePagination = require('../utils/pagination')
const analyticsService = require('../services/analyticsService')
const { CATEGORIES, normalizeGuideInfo } = require('../utils/guideInfo')

// 文章分类白名单（设计文档 3.3 与前端 Write.vue CATEGORIES 一致）

// 2026-08-13 修复（P1-1/P1-2）：字段边界校验 + game_id/cover 合法性，防外键/超长直撞 500
// 返回 null 表示校验通过，否则返回错误信息
function validatePostBody(body) {
  const { title, content, cover, game_id, category, video } = body
  for (const [key, value] of Object.entries({ title, content, category })) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) return `${key} 必须为非空文本`
  }
  for (const [key, value] of Object.entries({ cover, video })) {
    if (value !== undefined && value !== null && typeof value !== 'string') return `${key} 格式错误`
  }
  if (game_id !== undefined && (!/^[1-9]\d*$/.test(String(game_id)) || !Number.isSafeInteger(Number(game_id)))) return '游戏编号无效'
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 20 || body.tags.some(t => typeof t !== 'string' || !t.trim() || Array.from(t.trim()).length > 30))) return '标签格式错误（最多20个，每个1~30字）'
  if (title !== undefined && (!title || title.length > 200)) return '标题不能为空且不能超过 200 字'
  if (content !== undefined && !content) return '内容不能为空'
  if (category !== undefined && (!CATEGORIES.includes(category) || category.length > 30)) {
    return '分类不合法（BOSS攻略/新手入门/剧情解析/装备评测/全收集/Build分享）'
  }
  if (cover !== undefined && cover && !cover.startsWith('/uploads/')) return 'cover 须为 /uploads/ 开头的上传路径'
  if (video !== undefined && video && !video.startsWith('/uploads/')) return 'video 须为 /uploads/ 开头的上传路径'
  return null
}

// 校验 game_id 存在（create 必传，update 传了才校验）；不存在返回错误信息
async function validateGame(game_id) {
  if (game_id === undefined) return null
  const game = await gameService.findById(+game_id)
  if (!game) return '游戏不存在'
  return null
}

async function getList(req, res) {
  const { game_id, category, keyword, tag, tag_id, user_id, ids, sort } = req.query
  if (keyword !== undefined && (typeof keyword !== 'string' || Array.from(keyword.trim()).length > 200)) return response.error(res, '关键词最多200字')
  if (category !== undefined && !CATEGORIES.includes(category)) return response.error(res, '分类不合法')
  if (game_id !== undefined && (typeof game_id !== 'string' || !/^[1-9]\d*$/.test(game_id) || !Number.isSafeInteger(Number(game_id)))) return response.error(res, '游戏编号无效')
  const pagination = parsePagination(req.query, { defaultPageSize: 12, maxPageSize: 50 })
  const result = await postService.findList({ game_id, category, keyword: keyword?.trim(), tag, tag_id, user_id, ids, ...pagination, sort })
  response.paginated(res, result)
}

async function getDetail(req, res) {
  const post = await postService.getPublicDetail(req.params.id)
  // 仅 published 公开（与列表一致）；草稿/待审/驳回作者通过 /my/list 查看
  if (!post || post.status !== 'published') return response.error(res, '文章不存在', 404, 404)
  // 审核状态必须即时生效；在引入可靠 ETag/缓存失效前禁止共享缓存保留旧正文。
  res.set('Cache-Control', 'no-store')
  response.success(res, post)
}

async function recordView(req, res) {
  const visitorId = req.body && req.body.visitor_id
  if (!req.user && (typeof visitorId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(visitorId))) {
    return response.error(res, 'visitor_id 不合法')
  }
  const result = await analyticsService.recordView({
    postId: +req.params.id,
    actorId: req.user ? req.user.id : null,
    visitorId: typeof visitorId === 'string' ? visitorId : '',
    userAgent: req.get('user-agent') || '',
  })
  if (result === null) return response.error(res, '文章不存在', 404, 404)
  response.success(res, result)
}

async function create(req, res) {
  const { title, content, cover, game_id, category, tags, video, request_id } = req.body
  if (!title || !content || !game_id || !category) {
    return response.error(res, '标题、内容、游戏、分类不能为空')
  }
  const errMsg = validatePostBody(req.body)
  if (errMsg) return response.error(res, errMsg)
  if (request_id !== undefined && (typeof request_id !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(request_id))) return response.error(res, '创建请求编号不合法')
  // 强制 draft：status 不接受请求体（状态流转唯一入口是 submit → admin 审核）
  const result = await postService.createComplete({
    title, content, cover, game_id, category, user_id: req.user.id, tags, video, request_id, guide_info: normalizeGuideInfo(req.body.guide_info),
  })
  response.success(res, result, '草稿已保存')
}

// 本人权限校验：仅文章作者或 admin 可操作（修复原实现任意 creator 可改他人文章的漏洞）
async function assertOwner(req, res, postId) {
  const post = await postService.findById(postId)
  if (!post) { response.error(res, '文章不存在', 404, 404); return null }
  if (req.user.role !== 'admin' && post.user_id !== req.user.id) {
    response.error(res, '无权操作他人文章', 403, 403)
    return null
  }
  return post
}

async function update(req, res) {
  const { title, content, cover, game_id, category, tags, video } = req.body
  const post = await assertOwner(req, res, req.params.id)
  if (!post) return
  const version = req.body.content_version
  if (!Number.isSafeInteger(version) || version < 1) return response.error(res, '请提供当前文章版本，重新打开编辑页后重试')
  const errMsg = validatePostBody(req.body)
  if (errMsg) return response.error(res, errMsg)
  const gameErr = await validateGame(game_id)
  if (gameErr) return response.error(res, gameErr)
  const result = await postService.updateComplete(
    req.params.id,
    { title, content, cover, game_id, category, guide_info: req.body.guide_info === undefined ? undefined : normalizeGuideInfo(req.body.guide_info) },
    { tags, video, ownerId: post.user_id, version }
  )
  if (!result) return response.error(res, '文章不存在', 404, 404)
  if (result.status === 'pending') {
    return response.success(res, result, result.is_revision ? '修订已提交审核，原文章继续公开' : '已更新，文章等待审核')
  }
  response.success(res, result, '更新成功')
}

async function remove(req, res) {
  const post = await assertOwner(req, res, req.params.id)
  if (!post) return
  // 只解除资产引用，物理文件由过期清理任务在全局无引用时回收。
  await postService.removeComplete(req.params.id)
  response.success(res, null, '删除成功')
}

async function submit(req, res) {
  const post = await assertOwner(req, res, req.params.id)
  if (!post) return
  // 2026-08-13 修复（P1-8）：仅 draft/rejected 可提交，published 重复提交会打回待审、pending 重复提交无意义
  const editable = post.status === 'published' ? await postService.getManageDetail(post.id) : post
  if (!editable) return response.error(res, '文章不存在', 404, 404)
  if (editable.status !== 'draft' && editable.status !== 'rejected') {
    return response.error(res, '当前状态不可提交审核', 400, 400)
  }
  const changed = await postService.updateStatus(req.params.id, 'pending')
  if (!changed) return response.error(res, '文章状态已变化，请刷新后重试', 409, 409)
  response.success(res, null, '已提交审核')
}

async function getMyPosts(req, res) {
  const pagination = parsePagination(req.query, { defaultPageSize: 10, maxPageSize: 50 })
  const result = await postService.findByUser(req.user.id, pagination)
  response.paginated(res, result)
}

// 编辑页专用详情：公开详情只允许 published，此接口明确校验作者/admin 后返回全部状态文章。
async function getManageDetail(req, res) {
  const post = await assertOwner(req, res, req.params.id)
  if (!post) return
  const result = await postService.getManageDetail(req.params.id)
  if (!result) return response.error(res, '文章不存在', 404, 404)
  res.set('Cache-Control', 'no-store')
  response.success(res, result)
}

async function checkStatus(req, res) {
  // D17：返回 { liked, favorited, is_followed }
  const result = await postService.getStatus(req.user.id, req.params.id)
  if (!result) return response.error(res, '文章不存在', 404, 404)
  response.success(res, result)
}

module.exports = { getList, getDetail, recordView, create, update, remove, submit, getMyPosts, getManageDetail, checkStatus }
