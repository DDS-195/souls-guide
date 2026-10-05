const path = require('path')
const response = require('../utils/response')
const mediaService = require('../services/mediaService')
const videoService = require('../services/videoService')
const assetService = require('../services/assetService')
const { validateImageFile } = require('../utils/mediaValidation')
const cleanupService = require('../services/cleanupService')

const HASH_RE = /^[a-f0-9]{32}$/
const SERVER_ROOT = path.join(__dirname, '..', '..')

// POST /api/media/upload/image —— 图片上传（★已声明，auth+creator/admin，≤5MB 由 upload.js 限制）
async function uploadImage(req, res) {
  if (!req.file) return response.error(res, '请选择图片')
  await validateImageFile(req.file)
  // 磁盘路径 → URL：相对 server 根（不依赖 destination 是相对还是绝对路径）
  const url = '/' + path.relative(SERVER_ROOT, req.file.path).split(path.sep).join('/')
  try {
    const asset = await assetService.registerUpload(req.user.id, { url, type: 'image' })
    // Prebuild fixed variants for new images; original upload remains usable on failure.
    const variants = require('../middlewares/responsiveImage')
    await Promise.all(variants.widths.map(w => variants.variant(req.file.path, w))).catch(() => {})
    response.success(res, { url, asset_id: asset.id }, '上传成功')
  } catch (err) {
    await mediaService.unlinkUploads(url)
    throw err
  }
}

// POST /api/media/upload/video/status —— 断点续传状态查询（▲后端先行契约）
// 返回已上传分片列表 uploadedChunks；url 非空 = 已合并完成，直接使用
async function videoStatus(req, res) {
  const hash = req.body && req.body.hash
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) return response.error(res, 'hash 参数不合法')
  try {
    const url = await videoService.findDoneUrl(hash, req.user.id)
    const uploadedChunks = url ? [] : await videoService.listUploadedChunks(hash, req.user.id, true)
    let assetId = null
    if (url) {
      const asset = await assetService.registerUpload(req.user.id, { url, hash, type: 'video' })
      assetId = asset.id
    }
    response.success(res, { uploadedChunks, url, asset_id: assetId })
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) return response.error(res, err.message, err.statusCode, err.statusCode)
    throw err
  }
}

// POST /api/media/upload/video/chunk —— 上传单个分片（幂等：重复上传直接成功）
async function videoChunk(req, res) {
  const { hash, index, totalChunks } = req.body || {}
  if (!req.file) return response.error(res, '请选择视频分片文件')
  const idx = Number(index)
  const total = Number(totalChunks)
  if (!Number.isInteger(idx) || idx < 0 || idx >= total) return response.error(res, '分片序号不合法')
  if (!Number.isInteger(total) || total < 1 || total > 100) return response.error(res, '分片数量不合法（1~100）')
  try {
    await videoService.saveChunk(hash, idx, req.file.buffer, req.user.id)
    response.success(res, { index: idx })
  } catch (err) {
    response.error(res, err.message, err.statusCode || 400, err.statusCode || 400)
  }
}

// POST /api/media/upload/video/merge —— 合并分片 → { url }（FFmpeg 可用时已转码 H.264 MP4）
async function videoMerge(req, res) {
  const { hash, totalChunks, originalName } = req.body || {}
  try {
    const url = await videoService.mergeChunks(hash, Number(totalChunks), originalName, req.user.id)
    const asset = await assetService.registerUpload(req.user.id, { url, hash, type: 'video' })
    response.success(res, { url, asset_id: asset.id }, '上传成功')
  } catch (err) {
    response.error(res, err.message, err.statusCode || 400, err.statusCode || 400)
  }
}

// Legacy endpoint: attached media may only change through versioned article editing.
// Keep ownership/not-found responses for old clients, but never mutate the article here.
async function deleteMedia(req, res) {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.error(res, '媒体编号不合法')
  const media = await mediaService.findMedia(id)
  if (!media) return response.error(res, '媒体不存在', 404, 404)
  if (req.user.role !== 'admin' && media.author_id !== req.user.id) {
    return response.error(res, '无权删除他人文章的媒体', 403, 403)
  }
  return response.error(res, '媒体已被文章引用，请通过编辑文章移除并保存', 409, 409)
}

async function deleteTemporaryAsset(req, res) {
  const assetId = Number(req.params.assetId)
  if (!Number.isInteger(assetId) || assetId < 1) return response.error(res, '资产编号不合法')
  const result = await assetService.expireTemporaryAsset(assetId, req.user)
  if (result === null) return response.error(res, '上传资产不存在', 404, 404)
  if (result === 'forbidden') return response.error(res, '无权删除他人的上传资产', 403, 403)
  if (result === 'attached') return response.error(res, '资产已被文章引用，请通过编辑文章移除', 409, 409)
  await cleanupService.cleanupExpiredAssets({ assetIds: [assetId] })
  response.success(res, null, '已删除')
}

module.exports = { uploadImage, videoStatus, videoChunk, videoMerge, deleteMedia, deleteTemporaryAsset }
