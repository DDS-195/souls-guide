const postService = require('../services/postService')
const gameService = require('../services/gameService')
const mediaService = require('../services/mediaService')
const response = require('../utils/response')

// 文章分类白名单（设计文档 3.3 与前端 Write.vue CATEGORIES 一致）
const CATEGORIES = ['BOSS攻略', '新手入门', '剧情解析', '装备评测', '全收集', 'Build分享']

// 2026-08-13 修复（P1-1/P1-2）：字段边界校验 + game_id/cover 合法性，防外键/超长直撞 500
// 返回 null 表示校验通过，否则返回错误信息
function validatePostBody(body) {
  const { title, content, cover, game_id, category, video } = body
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
  const { game_id, category, keyword, tag, tag_id, user_id, ids, page, pageSize, sort } = req.query
  const result = await postService.findList({ game_id, category, keyword, tag, tag_id, user_id, ids, page: +page || 1, pageSize: +pageSize || 12, sort })
  response.paginated(res, result)
}

async function getDetail(req, res) {
  const post = await postService.findById(req.params.id)
  // 仅 published 公开（与列表一致）；草稿/待审/驳回作者通过 /my/list 查看
  if (!post || post.status !== 'published') return response.error(res, '文章不存在', 404, 404)
  // 10.6 缓存策略：文章详情 Cache-Control: public, max-age=300（404 不走此路径，不缓存）
  res.set('Cache-Control', 'public, max-age=300')
  await postService.incrementViews(req.params.id)
  const [tags, media] = await Promise.all([
    postService.getTags(req.params.id),
    postService.getMedia(req.params.id) // D13：media 数组仅详情返回，无则 []
  ])
  response.success(res, { ...post, tags, media })
}

async function create(req, res) {
  const { title, content, cover, game_id, category, tags, video } = req.body
  if (!title || !content || !game_id || !category) {
    return response.error(res, '标题、内容、游戏、分类不能为空')
  }
  const errMsg = validatePostBody(req.body)
  if (errMsg) return response.error(res, errMsg)
  const gameErr = await validateGame(game_id)
  if (gameErr) return response.error(res, gameErr)
  // 强制 draft：status 不接受请求体（状态流转唯一入口是 submit → admin 审核）
  const id = await postService.create({ title, content, cover, game_id, category, user_id: req.user.id })
  if (tags) await postService.setTags(id, tags)
  await postService.saveMedia(id, { video, content }) // D13：video→media，content 内图片→media
  response.success(res, { id }, '发布成功')
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
  const errMsg = validatePostBody(req.body)
  if (errMsg) return response.error(res, errMsg)
  const gameErr = await validateGame(game_id)
  if (gameErr) return response.error(res, gameErr)
  if (video !== undefined || content !== undefined) {
    // P2-6：video 未传时 saveMedia 内部保留现有视频（见 postService.saveMedia）
    await postService.saveMedia(req.params.id, { video, content: content ?? post.content })
  }
  // 不接收 status：状态流转唯一入口是 submit → admin 审核（防越权绕过审核）
  await postService.update(req.params.id, { title, content, cover, game_id, category })
  if (tags) await postService.setTags(req.params.id, tags)
  // 2026-08-13 修复（P1-7）：编辑已发布文章 → 重置待审核，防止「先过审再改内容」绕过审核流程
  if (post.status === 'published') {
    await postService.updateStatus(req.params.id, 'pending')
    return response.success(res, null, '已更新，文章已重新提交审核')
  }
  response.success(res, null, '更新成功')
}

async function remove(req, res) {
  const post = await assertOwner(req, res, req.params.id)
  if (!post) return
  // 2026-08-13 修复（P2-5）：删除文章前收集磁盘文件（封面 + 媒体库），行删除后统一清理
  const diskUrls = [post.cover]
  for (const m of await postService.getMedia(req.params.id)) diskUrls.push(m.url)
  await postService.remove(req.params.id)
  await Promise.all(diskUrls.filter(Boolean).map(url => mediaService.unlinkUploads(url)))
  response.success(res, null, '删除成功')
}

async function submit(req, res) {
  const post = await assertOwner(req, res, req.params.id)
  if (!post) return
  // 2026-08-13 修复（P1-8）：仅 draft/rejected 可提交，published 重复提交会打回待审、pending 重复提交无意义
  if (post.status !== 'draft' && post.status !== 'rejected') {
    return response.error(res, '当前状态不可提交审核', 400, 400)
  }
  await postService.updateStatus(req.params.id, 'pending')
  response.success(res, null, '已提交审核')
}

async function getMyPosts(req, res) {
  const { page, pageSize } = req.query
  const result = await postService.findByUser(req.user.id, { page: +page || 1, pageSize: +pageSize || 10 })
  response.paginated(res, result)
}

async function checkStatus(req, res) {
  // D17：返回 { liked, favorited, is_followed }
  const result = await postService.getStatus(req.user.id, req.params.id)
  if (!result) return response.error(res, '文章不存在', 404, 404)
  response.success(res, result)
}

module.exports = { getList, getDetail, create, update, remove, submit, getMyPosts, checkStatus }
