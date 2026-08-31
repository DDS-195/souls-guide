const path = require('path')
const response = require('../utils/response')
const mediaService = require('../services/mediaService')
const videoService = require('../services/videoService')

const HASH_RE = /^[a-f0-9]{32}$/
const SERVER_ROOT = path.join(__dirname, '..', '..')

// POST /api/media/upload/image —— 图片上传（★已声明，auth+creator/admin，≤5MB 由 upload.js 限制）
async function uploadImage(req, res) {
  if (!req.file) return response.error(res, '请选择图片')
  // 磁盘路径 → URL：相对 server 根（不依赖 destination 是相对还是绝对路径）
  const url = '/' + path.relative(SERVER_ROOT, req.file.path).split(path.sep).join('/')
  response.success(res, { url }, '上传成功')
}

// POST /api/media/upload/video/status —— 断点续传状态查询（▲后端先行契约）
// 返回已上传分片列表 uploadedChunks；url 非空 = 已合并完成，直接使用
async function videoStatus(req, res) {
  const hash = req.body && req.body.hash
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) return response.error(res, 'hash 参数不合法')
  try {
    const [uploadedChunks, url] = await Promise.all([
      videoService.listUploadedChunks(hash),
      videoService.findDoneUrl(hash),
    ])
    response.success(res, { uploadedChunks, url })
  } catch (err) {
    response.error(res, err.message, 500, 500)
  }
}

// POST /api/media/upload/video/chunk —— 上传单个分片（幂等：重复上传直接成功）
async function videoChunk(req, res) {
  const { hash, index, totalChunks } = req.body || {}
  if (!req.file) return response.error(res, '请选择视频分片文件')
  const idx = Number(index)
  const total = Number(totalChunks)
  if (!Number.isInteger(idx) || idx < 0) return response.error(res, '分片序号不合法')
  if (!Number.isInteger(total) || total < 1 || total > 100) return response.error(res, '分片数量不合法（1~100）')
  try {
    await videoService.saveChunk(hash, idx, req.file.buffer)
    response.success(res, { index: idx })
  } catch (err) {
    response.error(res, err.message)
  }
}

// POST /api/media/upload/video/merge —— 合并分片 → { url }（FFmpeg 可用时已转码 H.264 MP4）
async function videoMerge(req, res) {
  const { hash, totalChunks, originalName } = req.body || {}
  try {
    const url = await videoService.mergeChunks(hash, Number(totalChunks), originalName)
    response.success(res, { url }, '上传成功')
  } catch (err) {
    response.error(res, err.message)
  }
}

// DELETE /api/media/:id —— 删除媒体（auth+本人/admin；media 行 + 磁盘文件）
async function deleteMedia(req, res) {
  const media = await mediaService.findMedia(req.params.id)
  if (!media) return response.error(res, '媒体不存在', 404, 404)
  if (req.user.role !== 'admin' && media.author_id !== req.user.id) {
    return response.error(res, '无权删除他人文章的媒体', 403, 403)
  }
  await mediaService.removeMedia(media.id, media.url)
  response.success(res, null, '删除成功')
}

module.exports = { uploadImage, videoStatus, videoChunk, videoMerge, deleteMedia }
