const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')
const assetService = require('./assetService')
const { decodeGuideInfo, invalid } = require('../utils/guideInfo')
const conflict = message => { throw Object.assign(new Error(message), { statusCode: 409, code: 409 }) }

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

// favorites_user_id / following_user_id are internal scopes, never taken from public query input.
async function findList({ game_id, category, keyword, tag, tag_id, user_id, favorites_user_id, following_user_id, ids, page = 1, pageSize = 12, sort = 'latest' }) {
  // Share the filter body explicitly; SELECT may contain subqueries with their own FROM.
  let fromSql = ` FROM posts p JOIN users u ON p.user_id = u.id JOIN games g ON p.game_id = g.id${favorites_user_id ? ' JOIN favorites saved ON saved.post_id=p.id' : ''} WHERE p.status = ?`
  const params = ['published']
  const conditions = []

  if (game_id) { conditions.push('p.game_id = ?'); params.push(game_id) }
  if (favorites_user_id) { conditions.push('saved.user_id = ?'); params.push(favorites_user_id) }
  if (following_user_id) {
    conditions.push('EXISTS (SELECT 1 FROM follows followed WHERE followed.follower_id=? AND followed.following_id=p.user_id)')
    params.push(following_user_id)
  }
  if (category) { conditions.push('p.category = ?'); params.push(category) }
  if (keyword) {
    // Literal substring matching: %, _ and the escape character must not become wildcards.
    const term = `%${keyword.replace(/[!%_]/g, c => '!' + c)}%`
    conditions.push("(p.title LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM post_tags search_pt JOIN tags search_t ON search_t.id=search_pt.tag_id WHERE search_pt.post_id=p.id AND search_t.name LIKE ? ESCAPE '!'))")
    params.push(term, term)
  }
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
    const idList = String(ids).split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).map(Number).filter(n => n > 0).slice(0, 100)
    if (idList.length) {
      conditions.push(`p.id IN (${idList.map(() => '?').join(',')})`)
      params.push(...idList)
    } else {
      conditions.push('p.id IN (0)') // 传了 ids 但无合法项 → 空列表（ids 是过滤器语义，不退化回全列表）
    }
  }

  if (conditions.length) fromSql += ' AND ' + conditions.join(' AND ')

  const orderBy = favorites_user_id ? 'saved.created_at DESC, saved.id DESC' : sort === 'hot' ? 'p.view_count DESC, p.id DESC' : 'COALESCE(p.published_at, p.created_at) DESC, p.id DESC'
  const sql = `SELECT p.id, p.title, p.cover, p.game_id, p.category, p.status,
    p.view_count, p.like_count, p.comment_count, p.user_id, p.created_at, p.updated_at,
    p.published_at, u.username, u.nickname, u.avatar, g.name AS game_name,
    EXISTS(SELECT 1 FROM media video_media WHERE video_media.post_id=p.id AND video_media.type='video') AS has_video`
    + fromSql + ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  params.push(String(pageSize), String((page - 1) * pageSize))

  return withTransaction(async (db) => {
  const [rows] = await db.execute(sql, params)

  // 2026-08-13 测试揭示的契约补齐：4.1 列表响应字段含 tags（JOIN post_tags + tags 批量取，同 findByUser 方案）
  for (const row of rows) {
    row.tags = []
    row.has_video = Number(row.has_video) === 1
  }
  if (rows.length) {
    const ids = rows.map(r => r.id)
    const marks = ids.map(() => '?').join(',')
    const [tagRows] = await db.execute(`SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id IN (${marks})`, ids)
    const tagMap = new Map()
    for (const t of tagRows) {
      if (!tagMap.has(t.post_id)) tagMap.set(t.post_id, [])
      tagMap.get(t.post_id).push(t.name)
    }
    for (const row of rows) row.tags = tagMap.get(row.id) || []
  }

  const countSql = 'SELECT COUNT(*) as total' + fromSql
  const countParams = params.slice(0, -2)
  const [countResult] = await db.execute(countSql, countParams)
  const total = countResult[0].total

  return { total, page, pageSize, list: rows }
  })
}

async function findById(id) {
  const [rows] = await pool.execute(
    'SELECT p.*, u.username, u.nickname, u.avatar, g.name as game_name FROM posts p JOIN users u ON p.user_id = u.id JOIN games g ON p.game_id = g.id WHERE p.id = ?',
    [id]
  )
  if (rows[0]) rows[0].guide_info = decodeGuideInfo(rows[0].guide_info)
  return rows[0]
}

async function getPublicDetail(id) {
  return withTransaction(async db => {
    const [[post]] = await db.execute(`SELECT p.*,u.username,u.nickname,u.avatar,g.name AS game_name
      FROM posts p JOIN users u ON u.id=p.user_id JOIN games g ON g.id=p.game_id
      WHERE p.id=? AND p.status='published'`, [id])
    if (!post) return null
    const [tags] = await db.execute('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=?', [id])
    const [media] = await db.execute('SELECT id,url,type,sort_order FROM media WHERE post_id=? ORDER BY sort_order,id', [id])
    const [[counts]] = await db.execute('SELECT COUNT(*) AS favorite_count FROM favorites WHERE post_id=?', [id])
    const { reject_reason, ...visible } = post
    return { ...visible, guide_info: decodeGuideInfo(post.guide_info), tags: tags.map(t => t.name), media, favorite_count: counts.favorite_count }
  })
}

// 创建一律 draft：status 状态机唯一入口是 updateStatus（submit/审核），禁止请求体直写 status（防越权绕过审核）
async function create({ title, content, cover, game_id, category, user_id }) {
  const [result] = await pool.execute(
    "INSERT INTO posts (title, content, cover, game_id, category, user_id, status) VALUES (?, ?, ?, ?, ?, ?, 'draft')",
    [title, content, cover || null, game_id, category, user_id]
  )
  return result.insertId
}

function buildAssetUsages({ cover, video, content }) {
  const usages = []
  if (cover) usages.push({ url: cover, usage_type: 'cover', sort_order: 0 })
  if (video) usages.push({ url: video, usage_type: 'video', sort_order: 0 })
  extractImages(content).forEach((url, index) => usages.push({ url, usage_type: 'content', sort_order: index + 1 }))
  return usages
}

async function setTagsOn(db, postId, tagNames) {
  await db.execute('DELETE FROM post_tags WHERE post_id = ?', [postId])
  if (!tagNames || !tagNames.length) return
  // Stable order reduces lock inversion when two posts introduce overlapping tags.
  for (const rawName of [...new Set(tagNames.map(name => String(name).trim()))].sort()) {
    const name = String(rawName).trim()
    if (!name) continue
    const [result] = await db.execute(
      'INSERT INTO tags (name) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [name]
    )
    const tagId = result.insertId
    await db.execute('INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)', [postId, tagId])
  }
}

async function saveMediaOn(db, postId, { video, content }) {
  await db.execute('DELETE FROM media WHERE post_id = ?', [postId])
  const rows = []
  if (video) rows.push({ url: video, type: 'video', sort_order: 0 })
  extractImages(content).forEach((url, index) => rows.push({ url, type: 'image', sort_order: index + 1 }))
  for (const row of rows) {
    await db.execute(
      'INSERT INTO media (post_id, url, type, sort_order) VALUES (?, ?, ?, ?)',
      [postId, row.url, row.type, row.sort_order]
    )
  }
}

async function createComplete({ title, content, cover, game_id, category, user_id, tags, video, request_id, guide_info = null }) {
  const hashBody = {
    title, content, cover: cover || null, game_id: Number(game_id), category,
    tags: [...new Set((tags || []).map(t => t.trim()))].sort(), video: video || null,
  }
  // Preserve hashes of legacy requests that had no guide metadata.
  if (guide_info) hashBody.guide_info = guide_info
  const payloadHash = require('crypto').createHash('sha256').update(JSON.stringify(hashBody)).digest('hex')
  return withTransaction(async (db) => {
    if (request_id) {
      // Lock the author before checking the key; concurrent retries see one committed result.
      await db.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [user_id])
      const [[request]] = await db.execute('SELECT payload_hash,post_id FROM post_create_requests WHERE user_id=? AND request_id=?', [user_id, request_id])
      if (request) {
        if (request.payload_hash !== payloadHash) conflict('同一创建请求不能更换内容，请重试原请求')
        if (!request.post_id) conflict('该请求对应的文章已删除，请重新开始写作')
        const [[post]] = await db.execute('SELECT content_version,status FROM posts WHERE id=?', [request.post_id])
        return { id: request.post_id, content_version: post.content_version, status: post.status, replayed: true }
      }
    }
    await require('./gameService').assertAssignable(db,game_id)
    if (guide_info?.video_chapters.length && !video) invalid('视频时间点需要关联主视频')
    const usages = buildAssetUsages({ cover, video, content })
    await assetService.assertOwnedUrls(user_id, usages, db)
    const [result] = await db.execute(
      "INSERT INTO posts (title, content, cover, game_id, category, user_id, guide_info, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')",
      [title, content, cover || null, game_id, category, user_id, guide_info ? JSON.stringify(guide_info) : null]
    )
    const postId = result.insertId
    await setTagsOn(db, postId, tags || [])
    await saveMediaOn(db, postId, { video, content })
    await assetService.replacePostAssets(postId, user_id, usages, db)
    if (request_id) await db.execute('INSERT INTO post_create_requests (user_id,request_id,payload_hash,post_id) VALUES (?,?,?,?)', [user_id, request_id, payloadHash, postId])
    return { id: postId, content_version: 1, status: 'draft', replayed: false }
  }, { deadlockRetries: 3 })
}

async function updateComplete(id, changes, { tags, video, ownerId, version }) {
  return withTransaction(async (db) => {
    const [[current]] = await db.execute('SELECT * FROM posts WHERE id=? FOR UPDATE', [id])
    if (!current) return 0
    if (current.content_version !== version) conflict('文章已被修改或审核，请保留当前内容并重新载入最新版本')
    if (changes.game_id !== undefined) await require('./gameService').assertAssignable(db,changes.game_id,current.game_id)
    if (current.status === 'published') {
      return require('./postRevisionService').saveOn(db, current, changes, { tags, video, ownerId })
    }
    const nextStatus = current.status === 'published' ? 'pending' : null
    const [[existingVideo]] = await db.execute(
      "SELECT url FROM media WHERE post_id=? AND type='video' ORDER BY sort_order LIMIT 1",
      [id]
    )
    const final = {
      cover: changes.cover !== undefined ? changes.cover : current.cover,
      content: changes.content !== undefined ? changes.content : current.content,
      video: video !== undefined ? video : (existingVideo ? existingVideo.url : null),
    }
    let guide = changes.guide_info === undefined ? decodeGuideInfo(current.guide_info) : changes.guide_info
    // An old editor changing/removing the video must not retain timestamps of the previous clip.
    if (changes.guide_info === undefined && video !== undefined && video !== (existingVideo?.url || null) && guide) guide = { ...guide, video_chapters: [] }
    if (guide?.video_chapters.length && !final.video) invalid('视频时间点需要关联主视频')
    const usages = buildAssetUsages(final)
    await assetService.assertOwnedUrls(ownerId, usages, db)

    const sets = ['content_version=content_version+1', 'guide_info=?']
    const params = [guide ? JSON.stringify(guide) : null]
    for (const field of ['title', 'content', 'cover', 'game_id', 'category']) {
      if (changes[field] !== undefined) {
        sets.push(`${field}=?`)
        params.push(field === 'cover' ? changes[field] || null : changes[field])
      }
    }
    if (nextStatus) {
      sets.push('status=?', 'reject_reason=NULL')
      params.push(nextStatus)
    }
    if (nextStatus || current.status === 'pending') sets.push('submitted_at=NOW()')
    if (sets.length) {
      params.push(id)
      await db.execute(`UPDATE posts SET ${sets.join(', ')} WHERE id=?`, params)
    }
    if (tags !== undefined) await setTagsOn(db, id, tags)
    await saveMediaOn(db, id, { video: final.video, content: final.content })
    await assetService.replacePostAssets(id, ownerId, usages, db)
    return { status: nextStatus || current.status, content_version: current.content_version + 1 }
  }, { deadlockRetries: 3 })
}

async function removeComplete(id) {
  return withTransaction(async (db) => {
    const [[post]] = await db.execute('SELECT id,cover FROM posts WHERE id=? FOR UPDATE', [id])
    if (!post) return 0
    // Separate reads also work with legacy URL columns using different collations.
    const [media] = await db.execute('SELECT url FROM media WHERE post_id=?', [id])
    const [revisionUrls] = await db.execute('SELECT a.url FROM upload_assets a JOIN post_revision_assets ra ON ra.asset_id=a.id WHERE ra.post_id=?', [id])
    const urls = [{ url: post.cover }, ...media, ...revisionUrls]
    const [result] = await db.execute('DELETE FROM posts WHERE id=?', [id])
    if (result.affectedRows) await assetService.markUrlsUnreferenced(urls.map((row) => row.url), db)
    return result.affectedRows
  })
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
  if (status !== 'pending') throw new Error('Unsupported status transition')
  return withTransaction(async db => {
  const [[post]] = await db.execute('SELECT id,status,content_version FROM posts WHERE id=? FOR UPDATE', [id])
  if (!post) return 0
  if (post.status === 'published') {
    const revision = await require('./postRevisionService').getOn(db, id)
    if (!revision || revision.status !== 'rejected') return 0
    const version = post.content_version + 1
    await db.execute("UPDATE post_revisions SET status='pending',reject_reason=NULL,submitted_at=NOW(),content_version=? WHERE post_id=?", [version,id])
    await db.execute('UPDATE posts SET content_version=?,updated_at=updated_at WHERE id=?', [version,id])
    return 1
  }
  const [result] = await db.execute(
    "UPDATE posts SET status=?, reject_reason=NULL, submitted_at=NOW(), content_version=content_version+1 WHERE id=? AND status IN ('draft','rejected')",
    [status, id]
  )
  return result.affectedRows
  })
}

async function remove(id) {
  const [result] = await pool.execute('DELETE FROM posts WHERE id = ?', [id])
  return result.affectedRows
}

async function setTags(postId, tagNames) {
  return setTagsOn(pool, postId, tagNames)
}

async function getTags(postId) {
  const [rows] = await pool.execute(
    'SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?',
    [postId]
  )
  return rows.map(r => r.name)
}

async function findByUser(userId, { page = 1, pageSize = 10 }) {
  return withTransaction(async db => {
  const [rows] = await db.execute(
    'SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [userId, String(pageSize), String((page - 1) * pageSize)]
  )
  // D22 方案 A 配套（2026-08-09）：my/list 补 media（仅 video，图片在 content 内嵌）+ tags，
  // 供 Write.vue 编辑回填（getDetail 对 draft/pending/rejected 404，回填唯一通道是 my/list）
  if (rows.length) {
    const ids = rows.map(r => r.id)
    const marks = ids.map(() => '?').join(',')
    const [videos] = await db.execute(`SELECT id, url, type, sort_order, post_id FROM media WHERE post_id IN (${marks}) AND type='video' ORDER BY sort_order`, ids)
    const [tagRows] = await db.execute(`SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id IN (${marks})`, ids)
    const [revisions] = await db.execute(`SELECT * FROM post_revisions WHERE post_id IN (${marks})`, ids)
    const revisionMap = new Map(revisions.map(r => [r.post_id, { ...r, payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload }]))
    const videoMap = new Map(), tagMap = new Map()
    for (const v of videos) (videoMap.get(v.post_id) || videoMap.set(v.post_id, []).get(v.post_id)).push({ id: v.id, url: v.url, type: v.type, sort_order: v.sort_order })
    for (const t of tagRows) (tagMap.get(t.post_id) || tagMap.set(t.post_id, []).get(t.post_id)).push(t.name)
    for (const row of rows) {
      row.guide_info = decodeGuideInfo(row.guide_info)
      row.media = videoMap.get(row.id) || []
      row.tags = tagMap.get(row.id) || []
      if (row.status === 'published') Object.assign(row, require('./postRevisionService').overlay(row, revisionMap.get(row.id)))
    }
  }
  const [[{ total }]] = await db.execute('SELECT COUNT(*) as total FROM posts WHERE user_id = ?', [userId])
  return { total, page, pageSize, list: rows }
  })
}

async function getManageDetail(id) {
  return withTransaction(async db => {
    const [[post]] = await db.execute('SELECT p.*,g.name AS game_name FROM posts p JOIN games g ON g.id=p.game_id WHERE p.id=? FOR UPDATE', [id])
    if (!post) return null
    const [tags] = await db.execute('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=?', [id])
    const [media] = await db.execute('SELECT id,url,type,sort_order FROM media WHERE post_id=? ORDER BY sort_order,id', [id])
    const result = { ...post, guide_info: decodeGuideInfo(post.guide_info), tags: tags.map(t => t.name), media }
    return post.status === 'published' ? require('./postRevisionService').decorateOn(db, result) : result
  })
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

async function getFavoriteCount(postId) {
  const [[{ favorite_count }]] = await pool.execute(
    'SELECT COUNT(*) AS favorite_count FROM favorites WHERE post_id=?',
    [postId]
  )
  return favorite_count
}

// D17：当前用户对文章的互动状态（liked / favorited / is_followed），文章不存在返回 null
async function getStatus(userId, postId) {
  const [[post]] = await pool.execute("SELECT user_id FROM posts WHERE id=? AND status='published'", [postId])
  if (!post) return null
  const [[{ liked }]] = await pool.execute('SELECT COUNT(*) as liked FROM likes WHERE user_id=? AND post_id=?', [userId, postId])
  const [[{ favorited }]] = await pool.execute('SELECT COUNT(*) as favorited FROM favorites WHERE user_id=? AND post_id=?', [userId, postId])
  const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM follows WHERE follower_id=? AND following_id=?', [userId, post.user_id])
  return { liked: !!liked, favorited: !!favorited, is_followed: cnt > 0 }
}

module.exports = {
  findList, findById,
  create, createComplete, update, updateComplete, updateStatus, remove, removeComplete,
  setTags, getTags, findByUser, saveMedia, getMedia, getFavoriteCount, getStatus,
  getManageDetail, getPublicDetail, extractImages, buildAssetUsages, setTagsOn, saveMediaOn,
}
