const express = require('express')
const router = express.Router()
const auth = require('../middlewares/auth')
const authorize = require('../middlewares/authorize')
const ah = require('../utils/asyncHandler')
const creatorController = require('../controllers/creatorController')

// 创作者数据统计（★前端已声明 creatorApi.getStats，契约见设计文档 4.1「创作者统计」）
router.get('/stats', auth, authorize('creator', 'admin'), ah(creatorController.getStats))

module.exports = router
