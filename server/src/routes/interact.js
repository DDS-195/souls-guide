const express = require('express')
const router = express.Router()
const auth = require('../middlewares/auth')
const ah = require('../utils/asyncHandler')
const ctrl = require('../controllers/interactController')

router.post('/posts/:id/like', auth, ah(ctrl.like))
router.post('/posts/:id/favorite', auth, ah(ctrl.favorite))
router.post('/follows/:id', auth, ah(ctrl.follow))
router.get('/posts/:postId/comments', ah(ctrl.getComments))
router.post('/posts/:postId/comments', auth, ah(ctrl.addComment))
router.post('/comments/:commentId/reply', auth, ah(ctrl.replyComment))
router.delete('/comments/:commentId', auth, ah(ctrl.deleteComment))
router.get('/favorites', auth, ah(ctrl.getFavorites))
router.get('/notifications', auth, ah(ctrl.getNotifications))
router.put('/notifications/read-all', auth, ah(ctrl.markRead))
router.put('/notifications/:id/read', auth, ah(ctrl.markRead))
router.get('/users/:id/followers', ah(ctrl.getFollowers))
router.post('/reports', auth, ah(ctrl.report)) // D21：举报提交（auth，body {target_type, target_id, reason}）
router.get('/users/:id/following', ah(ctrl.getFollowing))

module.exports = router
