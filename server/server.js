require('dotenv').config()
const path = require('path')
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const { createLogWriter } = require('./src/utils/logWriter')

// D23 日志体系（10.8）：访问日志按天落盘（开发模式控制台 dev 格式保留，文件走完整格式带 IP）
const accessWriter = createLogWriter(path.join(__dirname, 'logs', 'access'), 'access')
const errorWriter = createLogWriter(path.join(__dirname, 'logs', 'error'), 'error')
const accessFormat = ':remote-addr - :date[iso] ":method :url HTTP/:http-version" :status :res[content-length] - :response-time ms ":user-agent"'

const app = express()

app.use(cors())
app.use(morgan('dev'))
app.use(morgan(accessFormat, { stream: accessWriter.stream }))
// 2026-08-13 修复（P1-4）：JSON body 上限 100KB→1MB——TinyMCE 富文本长攻略 content 为 LONGTEXT，
// 默认 100KB 上限会 413 且被 errorHandler 兜成 500；1MB 覆盖正常图文攻略（图片走 URL 引用不占 body）
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))
// 静态目录用绝对路径（不依赖启动 cwd，与 upload.js / videoService.js 统一）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

app.get('/', (req, res) => {
  res.json({ code: 0, message: 'SoulsGuide API OK' })
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
app.listen(PORT, () => {
  console.log(`SoulsGuide API → http://localhost:${PORT}`)
})

// D23 进程级兜底（10.8）：未捕获异常/未处理 rejection 落 fatal 日志后退出（不静默吞）
function fatalLog(label, err) {
  const line = `[${new Date().toISOString()}] ${label}: ${err && err.stack ? err.stack : String(err)}\n`
  try { errorWriter.write(line) } catch (e) { /* ignore */ }
  console.error(label, err)
}
process.on('uncaughtException', (err) => { fatalLog('uncaughtException', err); process.exit(1) })
process.on('unhandledRejection', (reason) => { fatalLog('unhandledRejection', reason) })
