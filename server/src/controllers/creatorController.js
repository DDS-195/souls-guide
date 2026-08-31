const creatorService = require('../services/creatorService')
const response = require('../utils/response')

// GET /api/creator/stats —— 创作者数据统计（设计文档 4.1「创作者统计」契约，auth+creator/admin）
async function getStats(req, res) {
  const stats = await creatorService.getStats(req.user.id)
  response.success(res, stats)
}

module.exports = { getStats }
