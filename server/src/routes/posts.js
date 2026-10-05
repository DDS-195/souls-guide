const express = require('express')
const router = express.Router()
const auth = require('../middlewares/auth')
const { authOptional } = require('../middlewares/auth')
const authorize = require('../middlewares/authorize')
const ah = require('../utils/asyncHandler')
const rateLimit = require('../utils/rateLimit')
const postController = require('../controllers/postController')
const viewLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: '阅读上报过于频繁，请稍后再试' })

// 公开接口
router.get('/', ah(postController.getList))
router.get('/:id', ah(postController.getDetail))
router.post('/:id/view', viewLimiter, authOptional, ah(postController.recordView))

// 需登录
router.get('/:id/status', auth, ah(postController.checkStatus))
router.get('/manage/:id', auth, authorize('creator', 'admin'), ah(postController.getManageDetail))

// 创作者
router.post('/', auth, authorize('creator', 'admin'), ah(postController.create))
router.put('/:id', auth, authorize('creator', 'admin'), ah(postController.update))
router.delete('/:id', auth, authorize('creator', 'admin'), ah(postController.remove))
router.post('/:id/submit', auth, authorize('creator', 'admin'), ah(postController.submit))
router.get('/my/list', auth, authorize('creator', 'admin'), ah(postController.getMyPosts))

module.exports = router
