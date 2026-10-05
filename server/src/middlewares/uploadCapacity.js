const fs = require('fs/promises')
const storageBudget = require('../utils/storageBudget')

function createUploadCapacity({ statfs = fs.statfs, env = process.env } = {}) {
  let active = 0
  return async (req, res, next) => {
    const upload = req.method === 'POST' && (req.is('multipart/form-data') || req.path === '/api/media/upload/video/merge')
    if (!upload || env.NODE_ENV !== 'production') return next()
    if (active >= 6) return res.status(503).set('Retry-After', '10').json({ code: 503, message: '上传繁忙，请稍后重试', data: null })
    active++
    let released = false
    let releaseSpace = () => {}
    const release = () => { if (!released) { released = true; active--; releaseSpace() } }
    res.once('finish', release)
    res.once('close', release)
    try {
      // Merge jobs reserve their own output space until completion, independent of HTTP.
      releaseSpace = await storageBudget.reserve(req.path.endsWith('/merge') ? 0 : 20 * 1024 * 1024, { env, statfs })
      if (!released) next()
      else releaseSpace()
    } catch (err) {
      if (!released && err.statusCode === 503) return res.status(503).set('Retry-After', '60').json({ code: 503, message: err.message, data: null })
      if (!released) res.status(503).json({ code: 503, message: '存储暂时不可用', data: null })
    }
  }
}
module.exports = createUploadCapacity
