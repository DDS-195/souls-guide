const pool = require('../config/db')
const session = require('../utils/mediaSession')

module.exports = async function mediaAccess(req, res, next) {
  // Recheck visibility on every request, including conditional and Range requests.
  res.set('Cache-Control', 'private, no-store')
  if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405)
  let url
  try { url = '/uploads' + decodeURIComponent(req.path) } catch { return res.sendStatus(404) }
  if (!/^\/uploads\/[A-Za-z0-9/_\-.]+$/.test(url) || url.includes('..') || url.includes('/.') || url.startsWith('/uploads/_derived/') || url.startsWith('/uploads/videos/tmp/')) return res.sendStatus(404)
  try {
    const [[visibility]] = await pool.execute(
      `SELECT
        EXISTS(SELECT 1 FROM users WHERE avatar=?) OR
        EXISTS(SELECT 1 FROM games WHERE cover=?) OR
        EXISTS(SELECT 1 FROM posts WHERE cover=? AND status='published') OR
        EXISTS(SELECT 1 FROM media m JOIN posts p ON p.id=m.post_id WHERE m.url=? AND p.status='published') OR
        EXISTS(SELECT 1 FROM upload_assets a JOIN post_assets pa ON pa.asset_id=a.id JOIN posts p ON p.id=pa.post_id
          WHERE a.url=? AND a.status='attached' AND p.status='published') AS is_public`,
      [url, url, url, url, url]
    )
    if (Number(visibility.is_public)) {
      res.locals.publicMedia = true
      res.set('Cache-Control', 'private, no-cache')
      return next()
    }
    const grant = session.read(req)
    if (!grant) return res.sendStatus(404)
    const [[user]] = await pool.execute('SELECT role,status,token_version FROM users WHERE id=?', [grant.id])
    if (!user || user.status !== 1 || user.token_version !== grant.ver) return res.sendStatus(404)
    const [[asset]] = await pool.execute(
      `SELECT EXISTS(SELECT 1 FROM upload_assets WHERE url=? AND status<>'deleted' AND (owner_id=? OR ?='admin')) OR
        EXISTS(SELECT 1 FROM posts WHERE cover=? AND (user_id=? OR ?='admin')) OR
        EXISTS(SELECT 1 FROM media m JOIN posts p ON p.id=m.post_id WHERE m.url=? AND (p.user_id=? OR ?='admin')) AS allowed`,
      [url, user.role === 'admin' ? 0 : grant.id, user.role, url, grant.id, user.role, url, grant.id, user.role]
    )
    if (!Number(asset.allowed)) return res.sendStatus(404)
    next()
  } catch (err) { next(err) }
}
