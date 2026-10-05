const assetService = require('./assetService')
const { decodeGuideInfo, invalid } = require('../utils/guideInfo')

const decode = value => typeof value === 'string' ? JSON.parse(value) : value

async function getOn(db, postId) {
  const [[revision]] = await db.execute('SELECT * FROM post_revisions WHERE post_id=?', [postId])
  return revision ? { ...revision, payload: decode(revision.payload) } : null
}

function overlay(post, revision) {
  if (!revision) return post
  const data = revision.payload
  const images = require('./postService').extractImages(data.content)
  return {
    ...post, ...data, public_status: post.status, is_revision: true,
    status: revision.status, content_version: revision.content_version,
    reject_reason: revision.reject_reason, submitted_at: revision.submitted_at,
    updated_at: revision.updated_at,
    media: [
      ...(data.video ? [{ id: 0, url: data.video, type: 'video', sort_order: 0 }] : []),
      ...images.map((url, i) => ({ id: 0, url, type: 'image', sort_order: i + 1 })),
    ],
  }
}

async function saveOn(db, post, changes, { tags, video, ownerId }) {
  const previous = await getOn(db, post.id)
  const [[mainVideo]] = await db.execute("SELECT url FROM media WHERE post_id=? AND type='video' ORDER BY sort_order,id LIMIT 1", [post.id])
  const [tagRows] = await db.execute('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=? ORDER BY t.id', [post.id])
  const base = previous?.payload || {
    title: post.title, content: post.content, cover: post.cover, game_id: post.game_id,
    category: post.category, guide_info: decodeGuideInfo(post.guide_info),
    tags: tagRows.map(t => t.name), video: mainVideo?.url || null,
  }
  const next = { ...base }
  for (const field of ['title', 'content', 'cover', 'game_id', 'category', 'guide_info']) {
    if (changes[field] !== undefined) next[field] = changes[field]
  }
  if (tags !== undefined) next.tags = tags
  if (video !== undefined) next.video = video || null
  next.cover = next.cover || null
  if (changes.guide_info === undefined && video !== undefined && next.video !== base.video && next.guide_info) {
    next.guide_info = { ...next.guide_info, video_chapters: [] }
  }
  if (next.guide_info?.video_chapters.length && !next.video) invalid('视频时间点需要关联主视频')
  const usages = require('./postService').buildAssetUsages(next)
  await assetService.assertOwnedUrls(ownerId, usages, db)
  const version = post.content_version + 1
  const status = previous?.status || 'pending'
  await db.execute(`INSERT INTO post_revisions (post_id,content_version,status,payload)
    VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE content_version=VALUES(content_version),
    payload=VALUES(payload),submitted_at=IF(status='pending',NOW(),submitted_at)`,
  [post.id, version, status, JSON.stringify(next)])
  await assetService.replaceRevisionAssets(post.id, ownerId, usages, db)
  // Keep canonical content and its visible last-edit time unchanged until approval.
  await db.execute('UPDATE posts SET content_version=?,updated_at=updated_at WHERE id=?', [version, post.id])
  return { status, public_status: 'published', is_revision: true, content_version: version }
}

async function applyOn(db, post, revision) {
  const data = revision.payload
  const posts = require('./postService')
  await db.execute(`UPDATE posts SET title=?,content=?,cover=?,game_id=?,category=?,guide_info=?,
    reject_reason=NULL,updated_at=NOW() WHERE id=?`,
  [data.title, data.content, data.cover, data.game_id, data.category,
    data.guide_info ? JSON.stringify(data.guide_info) : null, post.id])
  await posts.setTagsOn(db, post.id, data.tags)
  await posts.saveMediaOn(db, post.id, data)
  const usages = posts.buildAssetUsages(data)
  // Canonical attachments are replaced before dropping private references.
  await assetService.replacePostAssets(post.id, post.user_id, usages, db)
  await db.execute('DELETE FROM post_revisions WHERE post_id=?', [post.id])
}

async function decorateOn(db, post) {
  const result = overlay(post, await getOn(db, post.id))
  if (result.is_revision && result.game_id !== post.game_id) {
    const [[game]] = await db.execute('SELECT name FROM games WHERE id=?', [result.game_id])
    result.game_name = game?.name
  }
  return result
}

module.exports = { getOn, overlay, saveOn, applyOn, decorateOn }
