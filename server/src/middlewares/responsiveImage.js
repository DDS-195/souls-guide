const path = require('path')
const fs = require('fs/promises')
const crypto = require('crypto')
const sharp = require('sharp')
const root = path.resolve(__dirname, '../../uploads')
const widths = [480, 640, 800, 960, 1280]
const pending = new Map()
let queue = Promise.resolve()
sharp.concurrency(1)
sharp.cache({ memory: 16, files: 0, items: 20 })

// Fixed variants only; source access is checked by mediaAccess before reaching here.
async function variant(source, width) {
  source = path.resolve(source)
  if (!widths.includes(width)) throw new Error('Unsupported image width')
  const stat = await fs.stat(source)
  const key = crypto.createHash('sha256').update(source + ':' + stat.size + ':' + stat.mtimeMs + ':' + width + ':v1').digest('hex')
  const target = path.join(root, '_derived', key + '.webp')
  try { await fs.access(target); return target } catch {}
  if (pending.has(key)) return pending.get(key)
  if (pending.size >= 16) throw new Error('Image queue full')
  const job = queue.then(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true })
    const buffer = await sharp(source, { limitInputPixels: 20000000, animated: false })
      .timeout({ seconds: 15 }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 76 }).toBuffer()
    const temp = target + '.' + crypto.randomBytes(6).toString('hex') + '.tmp'
    try { await fs.writeFile(temp, buffer); await fs.rename(temp, target) }
    finally { await fs.unlink(temp).catch(() => {}) }
    return target
  }).finally(() => pending.delete(key))
  queue = job.catch(() => {})
  pending.set(key, job)
  return job
}

module.exports = async function responsiveImage(req, res, next) {
  if (!req.query.w) return next()
  const width = Number(req.query.w)
  if (typeof req.query.w !== 'string' || !widths.includes(width)) return res.sendStatus(400)
  let relative
  try { relative = decodeURIComponent(req.path) } catch { return res.sendStatus(404) }
  if (!/^\/images\/[^?]+\.(png|jpe?g|webp)$/i.test(relative)) return next()
  const source = path.resolve(root, '.' + relative)
  if (!source.startsWith(root + path.sep)) return res.sendStatus(404)
  try {
    const target = await variant(source, width)
    res.sendFile(target, { cacheControl: false, lastModified: !!res.locals.publicMedia, etag: !!res.locals.publicMedia }, err => {
      if (err && !res.headersSent) next(err)
    })
  } catch {
    // Preserve availability when decoding fails or queue is full; do not cache fallback.
    res.set('Cache-Control', 'private, no-store')
    next()
  }
}
module.exports.variant = variant
module.exports.widths = widths
module.exports.cleanup = async function () {
  const directory = path.join(root, '_derived')
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(err => {
    if (err.code === 'ENOENT') return []
    throw err
  })
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.webp(?:\.[a-f0-9]{12}\.tmp)?$/.test(entry.name)) continue
    const target = path.join(directory, entry.name)
    const stat = await fs.stat(target).catch(() => null)
    const ttl = entry.name.endsWith('.tmp') ? 86400000 : 14 * 86400000
    if (stat && Date.now() - stat.mtimeMs > ttl) await fs.unlink(target).catch(() => {})
  }
}
