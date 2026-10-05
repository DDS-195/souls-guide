const express = require('express')
const router = express.Router()
const auth = require('../middlewares/auth')
const { authOptional } = require('../middlewares/auth')
const uploadImage = require('../middlewares/upload')
const rateLimit = require('../utils/rateLimit')
const ah = require('../utils/asyncHandler')
const userController = require('../controllers/userController')

// 2026-08-13（P2-7）：登录/注册限流（60 秒 20 次/ IP），防暴力破解；零依赖内存实现见 utils/rateLimit.js
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 })
router.post('/register', loginLimiter, ah(userController.register))
router.post('/login', loginLimiter, ah(userController.login))
router.get('/me', auth, ah(userController.getMe))
router.put('/me/password', auth, ah(userController.changePassword))
router.post('/apply-creator', auth, ah(userController.applyCreator))
router.post('/me/avatar', auth, uploadImage.single('image'), ah(userController.uploadAvatar))
router.put('/me', auth, ah(userController.updateProfile))
// 他人主页（公开，可选鉴权：携带有效 token 时响应含 is_followed，D19；置于 /me 之后避免被 /:id 捕获）
router.get('/:id', authOptional, ah(userController.getProfile))

module.exports = router
