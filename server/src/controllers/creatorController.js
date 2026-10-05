const creatorService = require('../services/creatorService')
const response = require('../utils/response')

const CATEGORIES = ['BOSS攻略', '新手入门', '剧情解析', '装备评测', '全收集', 'Build分享']
const RANK_FIELDS = ['pv', 'uv', 'likes_added', 'favorites_added', 'comments_added', 'engagement_rate']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDate(value) {
  if (!DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().slice(0, 10) === value
}

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// GET /api/creator/stats —— 创作者数据统计（设计文档 4.1「创作者统计」契约，auth+creator/admin）
async function getStats(req, res) {
  const to = req.query.to || todayInShanghai()
  const from = req.query.from || creatorService.addDays(to, -29)
  if (!validDate(from) || !validDate(to) || from > to) return response.error(res, '统计日期范围不合法')
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
  if (days > 366) return response.error(res, '统计范围不能超过 366 天')

  const gameId = req.query.game_id === undefined ? null : +req.query.game_id
  const postId = req.query.post_id === undefined ? null : +req.query.post_id
  const category = req.query.category || null
  const rankBy = req.query.rank_by || 'pv'
  if (gameId !== null && (!Number.isInteger(gameId) || gameId < 1)) return response.error(res, 'game_id 不合法')
  if (postId !== null && (!Number.isInteger(postId) || postId < 1)) return response.error(res, 'post_id 不合法')
  if (category !== null && !CATEGORIES.includes(category)) return response.error(res, 'category 不合法')
  if (!RANK_FIELDS.includes(rankBy)) return response.error(res, 'rank_by 不合法')

  const previousTo = creatorService.addDays(from, -1)
  const previousFrom = creatorService.addDays(previousTo, -(days - 1))
  const stats = await creatorService.getStats(req.user.id, {
    from, to, previousFrom, previousTo, gameId, category, postId, rankBy,
  })
  response.success(res, stats)
}

module.exports = { getStats }
