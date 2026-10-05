const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')
const mediaService = require('./mediaService')
const videoService = require('./videoService')

async function cleanupExpiredAssets({ limit = 100, assetIds = null } = {}) {
  const candidates = await withTransaction(async (db) => {
    const params = []
    // A process may stop after marking a row deleted but before unlinking its file.
    // Keep tombstones retryable instead of leaving them orphaned forever.
    let where = "(a.status='deleted' OR (a.status='temporary' AND a.expires_at IS NOT NULL AND a.expires_at<=NOW()))"
    if (assetIds && assetIds.length) {
      const ids = assetIds.map(Number).filter(Number.isInteger)
      if (!ids.length) return []
      where += ` AND a.id IN (${ids.map(() => '?').join(',')})`
      params.push(...ids)
    }
    params.push(String(Math.max(1, Math.min(Number(limit) || 100, 500))))
    const [rows] = await db.execute(
      `SELECT a.id, a.url, a.hash, a.owner_id FROM upload_assets a
       WHERE ${where} AND NOT EXISTS (SELECT 1 FROM post_assets pa WHERE pa.asset_id=a.id)
       AND NOT EXISTS (SELECT 1 FROM post_revision_assets ra WHERE ra.asset_id=a.id)
       ORDER BY a.id LIMIT ? FOR UPDATE`,
      params
    )
    if (!rows.length) return []
    const marks = rows.map(() => '?').join(',')
    await db.execute(`UPDATE upload_assets SET status='deleted' WHERE id IN (${marks})`, rows.map((row) => row.id))
    return rows
  })

  for (const asset of candidates) {
    const removed = await mediaService.unlinkUploads(asset.url)
    if (removed && asset.hash) await videoService.clearDoneMarker(asset.hash, asset.url, asset.owner_id)
    if (removed) await pool.execute("DELETE FROM upload_assets WHERE id=? AND status='deleted'", [asset.id])
    else await pool.execute("UPDATE upload_assets SET status='temporary',expires_at=DATE_ADD(NOW(),INTERVAL 1 HOUR) WHERE id=? AND status='deleted'", [asset.id])
  }
  return candidates.length
}

async function cleanupUserAssets() {
  const [rows] = await pool.execute('SELECT url FROM user_asset_cleanup ORDER BY queued_at LIMIT 100')
  for (const { url } of rows) {
    try {
      if (await mediaService.unlinkUploads(url)) await pool.execute('DELETE FROM user_asset_cleanup WHERE url=?', [url])
    } catch (e) { console.error('[cleanup] 用户资产清理稍后重试:', e.message) }
  }
}
function startCleanupJobs() {
  const intervalMs = Math.max(60_000, Number(process.env.CLEANUP_INTERVAL_MS) || 60 * 60 * 1000)
  const run = async () => {
    try {
      await cleanupExpiredAssets()
      await cleanupUserAssets()
      const [covers] = await pool.execute('SELECT url FROM game_cover_cleanup ORDER BY queued_at LIMIT 100')
      for (const cover of covers) {
        if (await mediaService.unlinkUploads(cover.url)) await pool.execute('DELETE FROM game_cover_cleanup WHERE url=?',[cover.url])
      }
      await videoService.cleanupStaleTmp()
      await require('./analyticsMaintenance').cleanupTransientAnalytics()
      await require('../middlewares/responsiveImage').cleanup()
    } catch (err) {
      console.error('[cleanup] 清理任务失败:', err.message)
    }
  }
  setTimeout(run, Math.min(intervalMs, 5 * 60 * 1000)).unref()
  setInterval(run, intervalMs).unref()
}

module.exports = { cleanupExpiredAssets, cleanupUserAssets, startCleanupJobs }
