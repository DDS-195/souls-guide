const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const NAME = 'sg_media'
const key = () => crypto.createHmac('sha256', process.env.JWT_SECRET).update('souls-guide/media-read/v1').digest()

function issue(res, user) {
  // Read-only, purpose-separated credential; never accepted by API bearer authentication.
  // The client installs this ONLY if the response still belongs to its current session.
  // This avoids an in-flight response recreating a cookie after logout/account switching.
  const ttl = user.exp ? Math.max(1, Math.min(900, user.exp - Math.floor(Date.now() / 1000))) : 900
  const value = jwt.sign({ id: user.id, ver: user.ver ?? user.token_version ?? 0 }, key(), { audience: 'media-read', expiresIn: ttl })
  res.set('X-Media-Grant', value)
}

function read(req) {
  const entry = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(NAME + '='))
  if (!entry) return null
  try { return jwt.verify(decodeURIComponent(entry.slice(NAME.length + 1)), key(), { audience: 'media-read', algorithms: ['HS256'] }) } catch { return null }
}

module.exports = { issue, read }
