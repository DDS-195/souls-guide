const express = require('express')
const router = express.Router()
const auth = require('../middlewares/auth')
const authorize = require('../middlewares/authorize')
const { createLogMiddleware, GAME_RULES } = require('../middlewares/logOperation')
const ah = require('../utils/asyncHandler')
const gameController = require('../controllers/gameController')

// 公开
router.get('/', ah(gameController.getList))

// 管理（D15：契约归属 /api/games，auth+admin；D23：写操作自动审计，auth 之后挂中间件）
const logOp = createLogMiddleware(GAME_RULES)
router.post('/', auth, authorize('admin'), logOp, ah(gameController.createGame))
router.put('/sort', auth, authorize('admin'), logOp, ah(gameController.sortGames)) // 先于 /:id 注册
router.put('/:id', auth, authorize('admin'), logOp, ah(gameController.updateGame))
router.delete('/:id', auth, authorize('admin'), logOp, ah(gameController.deleteGame))

module.exports = router
