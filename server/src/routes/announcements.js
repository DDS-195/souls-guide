const express = require('express')
const router = express.Router()
const ah = require('../utils/asyncHandler')
const adminService = require('../services/adminService')
const response = require('../utils/response')
const auth = require('../middlewares/auth')
const { authOptional } = require('../middlewares/auth')
const rateLimit = require('../utils/rateLimit')
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: '公告已读上报过于频繁，请稍后再试' })

router.get('/latest', authOptional, ah(async (req, res) => {
  const ann = await adminService.getLatestAnnouncement(req.user?.id || null)
  response.success(res, ann)
}))

router.post('/:id/read', readLimiter, auth, ah(async (req, res) => {
  const id = Number(req.params.id)
  const version = Number(req.body && req.body.version)
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(version) || version < 1) {
    return response.error(res, '公告不存在', 404, 404)
  }
  const marked = await adminService.markAnnouncementRead(id, version, req.user.id)
  if (!marked) return response.error(res, '公告不存在或已失效', 404, 404)
  response.success(res, null, '已读状态已记录')
}))

module.exports = router
