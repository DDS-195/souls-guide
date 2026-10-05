const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')

const LOCAL_UPLOAD_RE = /^\/uploads\/(images|videos)\/[A-Za-z0-9/_\-.]+$/

function isLocalUploadUrl(url) {
  return typeof url === 'string' && LOCAL_UPLOAD_RE.test(url) && !url.includes('..')
}

function uniqueLocalUrls(usages) {
  return [...new Set(usages.map((item) => item.url).filter(isLocalUploadUrl))]
}

async function registerUpload(ownerId, { url, hash = null, type }, db = pool) {
  if (!isLocalUploadUrl(url)) throw new Error('上传资源路径不合法')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await db.execute(
    `INSERT INTO upload_assets (owner_id, url, hash, type, status, expires_at)
     VALUES (?, ?, ?, ?, 'temporary', ?)
     ON DUPLICATE KEY UPDATE hash=VALUES(hash), type=VALUES(type), status=IF(status='attached','attached','temporary'),
       expires_at=IF(status='attached',NULL,VALUES(expires_at))`,
    [ownerId, url, hash, type, expiresAt]
  )
  const [[asset]] = await db.execute(
    'SELECT id, owner_id, url, hash, type, status FROM upload_assets WHERE owner_id=? AND url=?',
    [ownerId, url]
  )
  return asset
}

async function assertOwnedUrls(ownerId, usages, db = pool) {
  const urls = uniqueLocalUrls(usages)
  if (!urls.length) return new Map()
  const marks = urls.map(() => '?').join(',')
  const [rows] = await db.execute(
    `SELECT id, url, type, status FROM upload_assets
     WHERE owner_id=? AND status<>'deleted' AND url IN (${marks}) FOR UPDATE`,
    [ownerId, ...urls]
  )
  const byUrl = new Map(rows.map((row) => [row.url, row]))
  const missing = urls.filter((url) => !byUrl.has(url))
  if (missing.length) {
    const err = new Error('文章引用了不属于当前作者的上传资源，请重新上传')
    err.statusCode = 403
    err.code = 403
    throw err
  }
  return byUrl
}

async function replaceAssets(table, postId, ownerId, usages, db) {
  const assets = await assertOwnedUrls(ownerId, usages, db)
  const [previous] = await db.execute(`SELECT asset_id FROM ${table} WHERE post_id=?`, [postId])
  await db.execute(`DELETE FROM ${table} WHERE post_id=?`, [postId])

  for (const usage of usages) {
    if (!isLocalUploadUrl(usage.url)) continue
    const asset = assets.get(usage.url)
    await db.execute(
      `INSERT IGNORE INTO ${table} (post_id, asset_id, usage_type, sort_order) VALUES (?, ?, ?, ?)`,
      [postId, asset.id, usage.usage_type, usage.sort_order || 0]
    )
    await db.execute("UPDATE upload_assets SET status='attached', expires_at=NULL WHERE id=?", [asset.id])
  }

  const previousIds = previous.map((row) => row.asset_id)
  if (previousIds.length) {
    const marks = previousIds.map(() => '?').join(',')
    await db.execute(
      `UPDATE upload_assets a SET a.status='temporary', a.expires_at=DATE_ADD(NOW(), INTERVAL 24 HOUR)
       WHERE a.id IN (${marks}) AND NOT EXISTS (SELECT 1 FROM post_assets pa WHERE pa.asset_id=a.id)
       AND NOT EXISTS (SELECT 1 FROM post_revision_assets ra WHERE ra.asset_id=a.id)`,
      previousIds
    )
  }
}

async function replacePostAssets(postId, ownerId, usages, db = pool) {
  return replaceAssets('post_assets', postId, ownerId, usages, db)
}
async function replaceRevisionAssets(postId, ownerId, usages, db = pool) {
  return replaceAssets('post_revision_assets', postId, ownerId, usages, db)
}

async function markUrlsUnreferenced(urls, db = pool) {
  const local = [...new Set(urls.filter(isLocalUploadUrl))]
  if (!local.length) return
  const marks = local.map(() => '?').join(',')
  await db.execute(
    `UPDATE upload_assets a SET a.status='temporary', a.expires_at=DATE_ADD(NOW(), INTERVAL 24 HOUR)
     WHERE a.url IN (${marks}) AND NOT EXISTS (SELECT 1 FROM post_assets pa WHERE pa.asset_id=a.id)
     AND NOT EXISTS (SELECT 1 FROM post_revision_assets ra WHERE ra.asset_id=a.id)`,
    local
  )
}

async function expireTemporaryAsset(assetId, actor, db = null) {
  if (!db) return withTransaction((conn) => expireTemporaryAsset(assetId, actor, conn))
  const [[asset]] = await db.execute(
    `SELECT a.id, a.owner_id, a.status,
       (EXISTS(SELECT 1 FROM post_assets pa WHERE pa.asset_id=a.id) OR
        EXISTS(SELECT 1 FROM post_revision_assets ra WHERE ra.asset_id=a.id)) AS attached
     FROM upload_assets a WHERE a.id=? FOR UPDATE`,
    [assetId]
  )
  if (!asset || asset.status === 'deleted') return null
  if (actor.role !== 'admin' && asset.owner_id !== actor.id) return 'forbidden'
  if (asset.status === 'attached' || asset.attached) return 'attached'
  await db.execute("UPDATE upload_assets SET expires_at=NOW() WHERE id=? AND status='temporary'", [assetId])
  return 'expired'
}

module.exports = {
  isLocalUploadUrl,
  registerUpload,
  assertOwnedUrls,
  replacePostAssets,
  replaceRevisionAssets,
  markUrlsUnreferenced,
  expireTemporaryAsset,
}
