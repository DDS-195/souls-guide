const express = require('express')
const router = express.Router()
const ah = require('../utils/asyncHandler')
const adminService = require('../services/adminService')
const response = require('../utils/response')

router.get('/latest', ah(async (req, res) => {
  const ann = await adminService.getLatestAnnouncement()
  response.success(res, ann)
}))

module.exports = router
