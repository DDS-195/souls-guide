const CATEGORIES = ['BOSS攻略', '新手入门', '剧情解析', '装备评测', '全收集', 'Build分享']
function invalid(message) { throw Object.assign(new Error(message), { statusCode: 400, code: 400 }) }
function normalizeGuideInfo(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) invalid('攻略概况格式错误')
  if (Object.keys(value).some(k => !['summary', 'game_version', 'prerequisites', 'spoiler', 'video_chapters'].includes(k))) invalid('攻略概况包含未知字段')
  const info = {}
  for (const [key, limit] of [['summary',400], ['game_version',40], ['prerequisites',600]]) {
    const text = value[key] ?? ''
    if (typeof text !== 'string' || Array.from(text.trim()).length > limit) invalid(`${key} 须为不超过${limit}字的文本`)
    info[key] = text.trim()
  }
  info.spoiler = value.spoiler ?? 'none'
  if (!['none','minor','major'].includes(info.spoiler)) invalid('剧透级别不合法')
  const chapters = value.video_chapters ?? []
  if (!Array.isArray(chapters) || chapters.length > 30) invalid('视频时间点最多30个')
  let previous = -1
  info.video_chapters = chapters.map(item => {
    if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.seconds) || item.seconds < 0 || item.seconds > 86400 || item.seconds <= previous || typeof item.title !== 'string' || !item.title.trim() || Array.from(item.title.trim()).length > 60) invalid('视频时间点须按时间递增，标题1~60字，时间0~86400秒')
    previous = item.seconds
    return { seconds: item.seconds, title: item.title.trim() }
  })
  return info.summary || info.game_version || info.prerequisites || info.spoiler !== 'none' || chapters.length ? info : null
}
function decodeGuideInfo(value) { return typeof value === 'string' ? JSON.parse(value) : value || null }
module.exports = { CATEGORIES, normalizeGuideInfo, decodeGuideInfo, invalid }
