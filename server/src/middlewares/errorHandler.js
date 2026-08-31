const path = require('path')
const { createLogWriter } = require('../utils/logWriter')

// D23 日志体系（10.8）：5xx 系统异常落盘（时间戳 + 请求行 + 完整堆栈）；4xx 业务拒绝不落盘（正常流程）
const errorWriter = createLogWriter(path.join(__dirname, '..', '..', 'logs', 'error'), 'error')

function errorHandler(err, req, res, next) {
  console.error('Server Error:', err.message)

  if (err.message.includes('只允许上传')) {
    return res.status(400).json({ code: 400, message: err.message })
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ code: 400, message: '文件大小不能超过 5MB' })
  }
  // 2026-08-13 修复（P1-4）：body 超限 / JSON 语法错误 / multer 其他限制类错误按 400 返回，不再兜成 500
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ code: 413, message: '请求体过大' })
  }
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({ code: 400, message: '请求体 JSON 格式错误' })
  }
  if (err.code && err.code.startsWith('LIMIT_')) {
    return res.status(400).json({ code: 400, message: err.message || '上传内容不合法' })
  }

  // 500：写错误日志（含堆栈 + 请求上下文），再响应
  const line = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}\n${err.stack || err.message}\n`
  errorWriter.write(line)

  res.status(500).json({
    code: 500,
    message: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
  })
}

module.exports = errorHandler
