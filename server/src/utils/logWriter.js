const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { maintainLogsUnlocked } = require('./logMaintenance')
const writers = new Map()
const maintaining = new Set()
let warnedWindows = false
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
const warn = error => console.error('[log-writer]', error.message || error)

async function maintainLogs(dir, prefix) {
  const key = path.resolve(dir) + ':' + prefix
  if (maintaining.has(key)) return
  maintaining.add(key)
  try {
    await fs.promises.mkdir(dir, { recursive: true })
    if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('Invalid log prefix')
    if (process.platform === 'win32') {
      // Windows 本地没有 flock。仍压缩/清理过期日志，但保留压缩原件，
      // 不把进程内锁冒充跨进程互斥；原子 link 防止覆盖其他维护者的归档。
      if (!warnedWindows) {
        warnedWindows = true
        warn(new Error('Windows maintenance uses conservative mode: compressed originals remain until retention expiry'))
      }
      await maintainLogsUnlocked(dir, prefix, { preserveOriginal: true })
    } else {
      const lockPath = path.join(dir, '.' + prefix + '-maintenance.lock')
      await new Promise((resolve, reject) => {
        // --no-fork 让实际维护 worker 持内核锁；退出/OOM/SIGKILL 自动释放。
        // 锁文件留在卷中是正常的，不能 unlink 它，否则会出现不同 inode 双持锁。
        const worker = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '--no-fork', lockPath,
          process.execPath, path.join(__dirname, 'logMaintenance.js'), path.resolve(dir), prefix],
        { stdio: ['pipe', 'ignore', 'pipe'] })
        let stderr = ''
        worker.stdin.on('error', () => {})
        worker.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16384) })
        worker.once('error', reject)
        worker.once('close', (code, signal) => {
          worker.stdin.destroy()
          if (stderr.trim()) warn(new Error(stderr.trim()))
          if (code === 0) resolve()
          else if (code === 73) {
            warn(new Error('Log maintenance skipped: another process currently owns the kernel lock'))
            resolve()
          } else reject(new Error(`Log maintenance worker failed (${signal || code}); ensure util-linux/flock is installed`))
        })
      })
    }
  } catch (e) { warn(e) }
  finally { maintaining.delete(key) }
}
function createLogWriter(dir, prefix) {
  dir = path.resolve(dir)
  const key = dir + ':' + prefix
  if (writers.has(key)) return writers.get(key)
  let chain = Promise.resolve()
  let queued = 0
  const write = line => {
    const text = String(line)
    if (queued >= 1000) { console.error('[log-writer] 队列已满，降级 stderr:', text); return }
    queued++
    const file = path.join(dir, prefix + '-' + day() + '.log')
    chain = chain.then(async () => {
      try { await fs.promises.mkdir(dir, { recursive: true }); await fs.promises.appendFile(file, text) }
      catch (e) { warn(e); console.error(text) }
      finally { queued-- }
    })
  }
  const maintenance = () => { chain = chain.then(() => maintainLogs(dir, prefix)) }
  maintenance()
  const timer = setInterval(maintenance, 3600000)
  timer.unref()
  const writer = { write, stream: { write }, flush: () => chain, close: async () => { clearInterval(timer); await chain; writers.delete(key) } }
  writers.set(key, writer)
  return writer
}
module.exports = { createLogWriter, maintainLogs }
