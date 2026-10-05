require('dotenv').config()
const validateProductionConfig = require('./src/utils/productionConfig')
validateProductionConfig()
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_HTTP === 'true') console.warn('[security] HTTP演示模式：登录密码与令牌未加密，仅用于受限测试')
const path = require('path')
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const { createLogWriter } = require('./src/utils/logWriter')
const runMigrations = require('./src/utils/migrate')
const bootstrap = require('./src/utils/bootstrap')
const { startCleanupJobs } = require('./src/services/cleanupService')
const requestId = require('./src/middlewares/requestId')

// D23 日志体系（10.8）：访问日志按天落盘（开发模式控制台 dev 格式保留，文件走完整格式带 IP）
const accessWriter = createLogWriter(path.join(__dirname, 'logs', 'access'), 'access')
const errorWriter = createLogWriter(path.join(__dirname, 'logs', 'error'), 'error')
morgan.token('request-id', (req) => req.id || '-')
morgan.token('safe-url', req => require('./src/utils/logRedaction').safePath(req.originalUrl))
morgan.token('safe-agent', req => String(req.get('user-agent') || '-').replace(/[\r\n\x00-\x1f]/g,'').slice(0,300))
const accessFormat = ':remote-addr [:request-id] - :date[iso] ":method :safe-url HTTP/:http-version" :status :res[content-length] - :response-time ms ":safe-agent"'

const app = express()

// 只信任部署拓扑中明确数量的反向代理。Docker 生产环境为 nginx 一跳；开发直连默认不信任转发头。
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0)
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) app.set('trust proxy', trustProxyHops)

app.use(requestId)
app.disable('x-powered-by')
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? process.env.PUBLIC_ORIGIN : '*', exposedHeaders: ['X-Request-Id', 'X-Media-Grant'] }))
if (process.env.NODE_ENV !== 'production') app.use(morgan(':method :safe-url :status :response-time ms'))
app.use(morgan(accessFormat, { stream: accessWriter.stream }))
app.use(require('./src/middlewares/uploadCapacity')())
// 2026-08-13 修复（P1-4）：JSON body 上限 100KB→1MB——TinyMCE 富文本长攻略 content 为 LONGTEXT，
// 默认 100KB 上限会 413 且被 errorHandler 兜成 500；1MB 覆盖正常图文攻略（图片走 URL 引用不占 body）
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))
// 静态目录用绝对路径（不依赖启动 cwd，与 upload.js / videoService.js 统一）
const publicMediaFiles = express.static(path.join(__dirname, 'uploads'), { cacheControl: false, etag: true, lastModified: true, dotfiles: 'deny' })
const privateMediaFiles = express.static(path.join(__dirname, 'uploads'), { cacheControl: false, etag: false, lastModified: false, dotfiles: 'deny' })
app.use('/uploads', require('./src/middlewares/mediaAccess'), require('./src/middlewares/responsiveImage'), (req, res, next) =>
  (res.locals.publicMedia ? publicMediaFiles : privateMediaFiles)(req, res, next))

app.get('/', (req, res) => {
  res.json({ code: 0, message: 'SoulsGuide API OK', data: { status: 'ok', request_id: req.id } })
})

// 运维端点不返回数据库错误或连接信息；仅由内网健康检查访问。
app.get('/health/ready', async (_req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    await require('./src/config/db').query({ sql: 'SELECT 1', timeout: 2000 })
    res.json({ status: 'ready' })
  } catch { res.status(503).json({ status: 'unavailable' }) }
})

app.use('/api/users', require('./src/routes/users'))
app.use('/api/games', require('./src/routes/games'))
app.use('/api/posts', require('./src/routes/posts'))
app.use('/api', require('./src/routes/interact'))
app.use('/api/admin', require('./src/routes/admin'))
app.use('/api/announcements', require('./src/routes/announcements'))
app.use('/api/media', require('./src/routes/media'))
app.use('/api/creator', require('./src/routes/creator'))

// 404 兜底（路由挂载之后）：未知 API 路径返回信封格式，前端拦截器可统一处理
app.use('/api', (req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在', data: null })
})

// 全局错误处理
const errorHandler = require('./src/middlewares/errorHandler')
app.use(errorHandler)

const PORT = process.env.PORT || 3000
let httpServer = null
let cleanupJobsStarted = false
async function start() {
  if (httpServer) return httpServer
  await runMigrations()
  await bootstrap()
  if (!cleanupJobsStarted) {
    startCleanupJobs()
    cleanupJobsStarted = true
  }
  return new Promise((resolve, reject) => {
    const candidate = app.listen(PORT, () => {
      httpServer = candidate
      console.log(`SoulsGuide API → http://localhost:${PORT}`)
      resolve(httpServer)
    })
    candidate.once('error', reject)
  })
}

async function stop() {
  if (!httpServer) return
  const running = httpServer
  httpServer = null
  await new Promise((resolve, reject) => running.close((err) => (err ? reject(err) : resolve())))
  await Promise.all([accessWriter.flush(), errorWriter.flush()])
}

// D23 进程级兜底（10.8）：未捕获异常/未处理 rejection 落 fatal 日志后退出（不静默吞）
function fatalLog(label, err) {
  const line = `[${new Date().toISOString()}] ${label}: ${require('./src/utils/logRedaction').redact(err && err.stack ? err.stack : String(err))}\n`
  try { errorWriter.write(line) } catch (e) { /* ignore */ }
  console.error(label, require('./src/utils/logRedaction').redact(err?.stack || err))
  return errorWriter.flush()
}
let exiting = false
async function fatalExit(label, err) {
  if (exiting) return
  exiting = true
  // 磁盘异常时最多等待两秒；stderr 已同步提交给进程输出。
  const timeout = setTimeout(() => process.exit(1), 2000)
  try { await fatalLog(label, err) } finally {
    clearTimeout(timeout)
    process.exit(1)
  }
}
process.on('uncaughtException', (err) => { void fatalExit('uncaughtException', err) })
process.on('unhandledRejection', (reason) => { void fatalExit('unhandledRejection', reason) })

if (require.main === module) {
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    const deadline = setTimeout(() => process.exit(1), 25000)
    try {
      await stop()
      await require('./src/config/db').end()
      clearTimeout(deadline)
      process.exit(0)
    } catch { process.exit(1) }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  start().catch((err) => {
    void fatalExit('startup failed', err)
  })
}

module.exports = { app, start, stop }
