const multer = require('multer')
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')

// 绝对路径（不依赖启动 cwd）：server/uploads/images/YYYY/MM/
const IMAGE_ROOT = path.join(__dirname, '..', '..', 'uploads', 'images')

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date()
    const dir = path.join(IMAGE_ROOT, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'))
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex')
    cb(null, `${Date.now()}-${unique}${path.extname(file.originalname)}`)
  }
})

const imageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  // 2026-08-07 用户批准放宽（契约 4.1）：浏览器对云盘管理目录内合法文件常报空类型（octet-stream），
  // mimetype 缺失但扩展名在白名单 → 放行；安全边界 = 扩展名白名单不变（同视频模块 videoUpload.js）
  if (allowed.includes(file.mimetype)) {
    cb(null, true)
  } else if (file.mimetype === 'application/octet-stream' && ALLOWED_IMAGE_EXT.includes(path.extname(file.originalname).toLowerCase())) {
    cb(null, true)
  } else {
    cb(new Error('只允许上传 jpg/png/gif/webp 格式')) // 前缀「只允许上传」与 errorHandler 400 分类规则对齐（同视频模块 videoUpload.js）
  }
}

// busboy 对恰好等于 limit 的文件会判定超限（实测 5MB 整被拒）→ 含 64KB 传输余量（D8「≤5MB」语义不变）
const IMAGE_LIMIT = 5 * 1024 * 1024 + 64 * 1024

// mimetype 缺失（octet-stream）时的扩展名白名单兜底（2026-08-07 用户批准，契约见 4.1）
const ALLOWED_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: IMAGE_LIMIT }
})

module.exports = uploadImage
