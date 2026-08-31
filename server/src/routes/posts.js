const express = require('express')
const router = express.Router()
const auth = require('../middlewares/auth')
const authorize = require('../middlewares/authorize')
const ah = require('../utils/asyncHandler')
const postController = require('../controllers/postController')

// 公开接口
router.get('/', ah(postController.getList))
router.get('/:id', ah(postController.getDetail))

// 需登录
router.get('/:id/status', auth, ah(postController.checkStatus))

// 创作者
router.post('/', auth, authorize('creator', 'admin'), ah(postController.create))
router.put('/:id', auth, authorize('creator', 'admin'), ah(postController.update))
router.delete('/:id', auth, authorize('creator', 'admin'), ah(postController.remove))
router.post('/:id/submit', auth, authorize('creator', 'admin'), ah(postController.submit))
router.get('/my/list', auth, authorize('creator', 'admin'), ah(postController.getMyPosts))

module.exports = router
