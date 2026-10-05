const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { pipeline } = require('stream/promises')
const { Writable } = require('stream')
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
const warn = error => console.error('[log-maintenance]', error.message || error)

async function digest(file, compressed = false) {
  const hash = crypto.createHash('sha256')
  const sink = new Writable({ write(chunk, enc, cb) { hash.update(chunk); cb() } })
  if (compressed) await pipeline(fs.createReadStream(file), zlib.createGunzip(), sink)
  else await pipeline(fs.createReadStream(file), sink)
  return hash.digest('hex')
}
async function unlinkMissingOk(file) {
  try { await fs.promises.unlink(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

// Linux 由 flock 在外层持锁；Windows 保守模式不删除压缩原件。
async function maintainLogsUnlocked(dir, prefix, { preserveOriginal = false } = {}) {
  const days = Math.max(1, Number(process.env.LOG_RETENTION_DAYS) || 30)
  for (const name of await fs.promises.readdir(dir)) {
    if (!name.startsWith(prefix + '-')) continue
    const match = name.slice(prefix.length + 1).match(/^(\d{4}-\d{2}-\d{2})\.log(\.gz)?$/)
    if (!match || match[1] >= day()) continue
    const date = Date.parse(match[1] + 'T00:00:00+08:00')
    if (!Number.isFinite(date)) continue
    const full = path.join(dir, name)
    try {
      if (!(await fs.promises.lstat(full)).isFile()) continue
      if (Date.now() - date > days * 86400000) { await unlinkMissingOk(full); continue }
      if (match[2]) continue
      const compressed = full + '.gz'
      try {
        await fs.promises.access(compressed)
        if (await digest(full) === await digest(compressed, true)) {
          if (!preserveOriginal) await unlinkMissingOk(full)
        } else warn(new Error('压缩副本与原日志不同，保留原文件：' + name))
      } catch (error) {
        if (error.code !== 'ENOENT') { warn(error); continue }
        const temp = compressed + '.' + crypto.randomUUID() + '.tmp'
        try {
          await pipeline(fs.createReadStream(full), zlib.createGzip(), fs.createWriteStream(temp, { flags: 'wx' }))
          // 原子发布且不覆盖任何归档；Windows 并发维护者只保留自己的原件。
          await fs.promises.link(temp, compressed)
          if (!preserveOriginal) await unlinkMissingOk(full)
        } catch (error) {
          if (!(preserveOriginal && ['EEXIST', 'ENOENT'].includes(error.code))) throw error
        } finally { await unlinkMissingOk(temp) }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

if (require.main === module) {
  // 父进程退出时 pipe EOF，不能让维护 worker 永久持锁等待输入。
  process.stdin.on('end', () => process.exit(130))
  process.stdin.on('error', () => process.exit(130))
  process.stdin.resume()
  maintainLogsUnlocked(process.argv[2], process.argv[3])
    .then(() => process.exit(0))
    .catch(error => { warn(error); process.exit(1) })
}
module.exports = { maintainLogsUnlocked }
