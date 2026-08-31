// 视频分片上传：multer 实例（内存接收，≤5MB/片）+ 常量（扩展名白名单 / 片数上限）
// 契约见设计文档 4.1 媒体模块 + 10.2 节（D12）
const multer = require('multer')
const path = require('path')

const ALLOWED_EXT = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv']
const MAX_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB/片（与图片上限一致）
const MAX_TOTAL_CHUNKS = 100 // 100 片 = 500MB 总上限
// busboy 对恰好等于 limit 的文件大小会判定超限（实测 5MB 整被拒），
// 客户端切片恰为 5MB 整 → multer limit 需含传输余量（契约「≤5MB/片」语义不变）
const CHUNK_LIMIT = MAX_CHUNK_SIZE + 64 * 1024

// 分片用内存接收（单片 ≤5MB，并发 3 片峰值 ~15MB，可控），由 controller 按 hash 落盘
const videoChunkUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // 2026-08-07 用户批准放宽（契约 4.1/10.2）：浏览器对云盘管理目录内合法文件常报空类型（octet-stream），
    // mimetype 缺失但扩展名在白名单 → 放行；安全边界 = 扩展名白名单不变
    if (file.mimetype.startsWith('video/')) {
      cb(null, true)
    } else if (file.mimetype === 'application/octet-stream' && ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true)
    } else {
      cb(new Error('只允许上传视频文件')) // errorHandler 按「只允许上传」前缀返回 400
    }
  },
  limits: { fileSize: CHUNK_LIMIT },
})

module.exports = { videoChunkUpload, ALLOWED_EXT, MAX_TOTAL_CHUNKS }
