const pool = require('../config/db')

// 解析 content 中的图片 URL，返回 url 数组（出现顺序即媒体顺序，D13 / D22）
// D22：content 格式 Markdown → HTML。优先解析 HTML <img src="...">（单双引号均支持）；
// 无 <img> 时回退兼容旧 Markdown ![alt](url)（历史数据已迁移为 HTML，双正则仅作防御）
function extractImages(content) {
  const urls = []
  const htmlRe = /<img\b[^>]*\bsrc=["']([^"']+)["']/g
  let m
  while ((m = htmlRe.exec(content || ''))) urls.push(m[1])
  if (urls.length) return urls
  const mdRe = /!\[[^\]]*\]\(([^)\s]+)\)/g
  while ((m = mdRe.exec(content || ''))) urls.push(m[1])
  return urls
}

async function findList({ game_id, category, keyword, tag, tag_id, user_id, ids, page = 1, pageSize = 12, sort = 'latest' }) {
  let sql = 'SELECT p.*, u.username, u.avatar, g.name as game_name FROM posts p JOIN users u ON p.user_id = u.id JOIN games g ON p.game_id = g.id WHERE p.status = ?'
  const params = ['published']
  const conditions = []

  if (game_id) { conditions.push('p.game_id = ?'); params.push(game_id) }
  if (category) { conditions.push('p.category = ?'); params.push(category) }
  if (keyword) { conditions.push('p.title LIKE ?'); params.push(`%${keyword}%`) }
  if (user_id) {
    // D19：按作者过滤（用户主页文章列表，仅 published）
    conditions.push('p.user_id = ?'); params.push(user_id)
  }
  if (tag_id) {
    // 契约参数 tag_id（4.1）
    conditions.push('p.id IN (SELECT post_id FROM post_tags WHERE tag_id = ?)')
    params.push(tag_id)
  } else if (tag) {
    // 兼容旧参数 tag（标签名）
    conditions.push('p.id IN (SELECT post_id FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE t.name = ?)')
    params.push(tag)
  }

  if (ids) {
    // D23 ids 批量取（浏览历史卡片实时补齐，4.1 A1→A2 备忘）：逗号分隔，仅接受纯数字串（parseInt 会把 '1.5' 宽容成 1，必须白名单），防注入
    const idList = String(ids).split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).map(Number).filter(n => n > 0)
    if (idList.length) {
      conditions.push(`p.id IN (${idList.map(() => '?').join(',')})`)
      params.push(...idList)
    } else {
      conditions.push('p.id IN (0)') // 传了 ids 但无合法项 → 空列表（ids 是过滤器语义，不退化回全列表）
    }
  }

  if (conditions.length) sql += ' AND ' + conditions.join(' AND ')

  const orderBy = sort === 'hot' ? 'p.view_count DESC' : 'p.created_at DESC'
  sql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  params.push(String(pageSize), String((page - 1) * pageSize))

  const [rows] = await pool.execute(sql, params)

  // 2026-08-13 测试揭示的契约补齐：4.1 列表响应字段含 tags（JOIN post_tags + tags 批量取，同 findByUser 方案）
  for (const row of rows) row.tags = []
  if (rows.length) {
    const ids = rows.map(r => r.id)
    const marks = ids.map(() => '?').join(',')
    const [tagRows] = await pool.execute(`SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id IN (${marks})`, ids)
    const tagMap = new Map()
    for (const t of tagRows) {
      if (!tagMap.has(t.post_id)) tagMap.set(t.post_id, [])
      tagMap.get(t.post_id).push(t.name)
    }
    for (const row of rows) row.tags = tagMap.get(row.id) || []
  }

  // 计数 SQL：取主查询第一个 FROM 之后的主体（贪心正则会被 tag 过滤子查询的第二个 FROM 截断，见 4.1 协作备忘 bug2），再去掉 ORDER BY/LIMIT
  const countSql = 'SELECT COUNT(*) as total' + sql.slice(sql.indexOf(' FROM ')).replace(/ ORDER BY[\s\S]*/, '')
  const countParams = params.slice(0, -2)
  const [countResult] = await pool.execute(countSql, countParams)
  const total = countResult[0].total

  return { total, page, pageSize, list: rows }
}

async function findById(id) {
  const [rows] = await pool.execute(
    'SELECT p.*, u.username, u.avatar, g.name as game_name FROM posts p JOIN users u ON p.user_id = u.id JOIN games g ON p.game_id = g.id WHERE p.id = ?',
    [id]
  )
  return rows[0]
}

async function incrementViews(id) {
  await pool.execute('UPDATE posts SET view_count = view_count + 1 WHERE id = ?', [id])
}

// 创建一律 draft：status 状态机唯一入口是 updateStatus（submit/审核），禁止请求体直写 status（防越权绕过审核）
async function create({ title, content, cover, game_id, category, user_id }) {
  const [result] = await pool.execute(
    "INSERT INTO posts (title, content, cover, game_id, category, user_id, status) VALUES (?, ?, ?, ?, ?, ?, 'draft')",
    [title, content, cover || null, game_id, category, user_id]
  )
  return result.insertId
}

// 部分更新：仅更新传入的字段（避免把未传字段置 NULL）；不接收 status（状态流转只走 updateStatus）
async function update(id, { title, content, cover, game_id, category }) {
  const sets = []
  const params = []
  if (title !== undefined) { sets.push('title=?'); params.push(title) }
  if (content !== undefined) { sets.push('content=?'); params.push(content) }
  if (cover !== undefined) { sets.push('cover=?'); params.push(cover || null) }
  if (game_id !== undefined) { sets.push('game_id=?'); params.push(game_id) }
  if (category !== undefined) { sets.push('category=?'); params.push(category) }
  if (!sets.length) return 0
  params.push(id)
  const [result] = await pool.execute(`UPDATE posts SET ${sets.join(', ')} WHERE id=?`, params)
  return result.affectedRows
}

// 仅更新状态（submit 用）
async function updateStatus(id, status) {
  const [result] = await pool.execute('UPDATE posts SET status=? WHERE id=?', [status, id])
  return result.affectedRows
}

async function remove(id) {
  const [result] = await pool.execute('DELETE FROM posts WHERE id = ?', [id])
  return result.affectedRows
}

async function setTags(postId, tagNames) {
  await pool.execute('DELETE FROM post_tags WHERE post_id = ?', [postId])
  if (!tagNames || !tagNames.length) return
  for (const name of tagNames) {
    let [rows] = await pool.execute('SELECT id FROM tags WHERE name = ?', [name])
    let tagId
    if (rows.length) {
      tagId = rows[0].id
    } else {
      const [r] = await pool.execute('INSERT INTO tags (name) VALUES (?)', [name])
      tagId = r.insertId
    }
    await pool.execute('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, tagId])
  }
}

async function getTags(postId) {
  const [rows] = await pool.execute(
    'SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?',
    [postId]
  )
  return rows.map(r => r.name)
}

async function findByUser(userId, { page = 1, pageSize = 10 }) {
  const [rows] = await pool.execute(
    'SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [userId, String(pageSize), String((page - 1) * pageSize)]
  )
  // D22 方案 A 配套（2026-08-09）：my/list 补 media（仅 video，图片在 content 内嵌）+ tags，
  // 供 Write.vue 编辑回填（getDetail 对 draft/pending/rejected 404，回填唯一通道是 my/list）
  if (rows.length) {
    const ids = rows.map(r => r.id)
    const marks = ids.map(() => '?').join(',')
    const [videos] = await pool.execute(`SELECT id, url, type, sort_order, post_id FROM media WHERE post_id IN (${marks}) AND type='video' ORDER BY sort_order`, ids)
    const [tagRows] = await pool.execute(`SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id IN (${marks})`, ids)
    const videoMap = new Map(), tagMap = new Map()
    for (const v of videos) (videoMap.get(v.post_id) || videoMap.set(v.post_id, []).get(v.post_id)).push({ id: v.id, url: v.url, type: v.type, sort_order: v.sort_order })
    for (const t of tagRows) (tagMap.get(t.post_id) || tagMap.set(t.post_id, []).get(t.post_id)).push(t.name)
    for (const row of rows) {
      row.media = videoMap.get(row.id) || []
      row.tags = tagMap.get(row.id) || []
    }
  }
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM posts WHERE user_id = ?', [userId])
  return { total, page, pageSize, list: rows }
}

// ===== D13：media 表写入 =====
// 重写该文章的 media 记录：video → type=video sort_order=0；
// content 中 ![alt](url) 图片 → type=image sort_order=1..n（content 为唯一真相源）
// 2026-08-13 修复（P2-6）：video === undefined 表示调用方未提及视频 → 保留现有视频记录
//（旧实现「不带 video 字段 = 清空视频」，PUT 只更新 content 时会误删视频 media；null 才是显式删除）
async function saveMedia(postId, { video, content }) {
  if (video === undefined) {
    const [existing] = await pool.execute("SELECT url FROM media WHERE post_id = ? AND type = 'video' ORDER BY sort_order", [postId])
    video = existing[0] ? existing[0].url : null
  }
  await pool.execute('DELETE FROM media WHERE post_id = ?', [postId])
  const rows = []
  if (video) rows.push({ url: video, type: 'video', sort_order: 0 })
  extractImages(content).forEach((url, i) => rows.push({ url, type: 'image', sort_order: i + 1 }))
  for (const row of rows) {
    await pool.execute('INSERT INTO media (post_id, url, type, sort_order) VALUES (?, ?, ?, ?)',
      [postId, row.url, row.type, row.sort_order])
  }
}

async function getMedia(postId) {
  const [rows] = await pool.execute(
    'SELECT id, url, type, sort_order FROM media WHERE post_id = ? ORDER BY sort_order ASC',
    [postId]
  )
  return rows
}

// D17：当前用户对文章的互动状态（liked / favorited / is_followed），文章不存在返回 null
async function getStatus(userId, postId) {
  const [[post]] = await pool.execute('SELECT user_id FROM posts WHERE id=?', [postId])
  if (!post) return null
  const [[{ liked }]] = await pool.execute('SELECT COUNT(*) as liked FROM likes WHERE user_id=? AND post_id=?', [userId, postId])
  const [[{ favorited }]] = await pool.execute('SELECT COUNT(*) as favorited FROM favorites WHERE user_id=? AND post_id=?', [userId, postId])
  const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM follows WHERE follower_id=? AND following_id=?', [userId, post.user_id])
  return { liked: !!liked, favorited: !!favorited, is_followed: cnt > 0 }
}

module.exports = { findList, findById, incrementViews, create, update, updateStatus, remove, setTags, getTags, findByUser, saveMedia, getMedia, getStatus }
