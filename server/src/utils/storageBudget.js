const fs = require('fs/promises')
const path = require('path')
let reserved = 0
let checking = Promise.resolve()

// The process owns reservations until the work finishes, even after HTTP disconnects.
async function reserve(bytes, { env = process.env, statfs = fs.statfs } = {}) {
  if (env.NODE_ENV !== 'production') return () => {}
  const previous = checking
  let unlock
  checking = new Promise(resolve => { unlock = resolve })
  await previous
  try {
    const disk = await statfs(path.join(__dirname, '../../uploads'))
    const floor = Number(env.MIN_UPLOAD_FREE_MB || 2048) * 1024 * 1024
    if (disk.bavail * disk.bsize - reserved - bytes < floor) {
      throw Object.assign(new Error('存储空间不足，暂时无法上传'), { statusCode: 503 })
    }
    reserved += bytes
    let released = false
    return () => { if (!released) { released = true; reserved -= bytes } }
  } finally { unlock() }
}
module.exports = { reserve }
