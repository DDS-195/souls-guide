const express = require('express')
const router = express.Router()
const auth = require('../middlewares/auth')
const authorize = require('../middlewares/authorize')
const ah = require('../utils/asyncHandler')
const uploadImage = require('../middlewares/upload')
const { videoChunkUpload } = require('../utils/videoUpload')
const mediaController = require('../controllers/mediaController')

// 图片上传（★已声明，auth+creator/admin，≤5MB 由 upload.js 限制）
router.post('/upload/image', auth, authorize('creator', 'admin'), uploadImage.single('image'), ah(mediaController.uploadImage))

// 视频分片上传（▲后端先行契约，见设计文档 4.1 媒体模块 + 10.2 节）
router.post('/upload/video/status', auth, authorize('creator', 'admin'), ah(mediaController.videoStatus))
router.post('/upload/video/chunk', auth, authorize('creator', 'admin'), videoChunkUpload.single('chunk'), ah(mediaController.videoChunk))
router.post('/upload/video/merge', auth, authorize('creator', 'admin'), ah(mediaController.videoMerge))

// 主动撤销尚未绑定文章的临时上传；已绑定资产必须通过文章更新/删除解除引用。
router.delete('/assets/:assetId', auth, authorize('creator', 'admin'), ah(mediaController.deleteTemporaryAsset))

// 删除媒体（auth+本人/admin：media 行 + 磁盘文件，见设计文档 4.1 媒体模块）
router.delete('/:id', auth, authorize('creator', 'admin'), ah(mediaController.deleteMedia))

module.exports = router
