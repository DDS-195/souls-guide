// D23 按天轮转写流（10.8 日志体系）：纯 fs 零新依赖。
// 用法：createLogWriter(logDir, prefix) → 返回 { stream, write(line) }
//   - stream：morgan 的 stream 选项（{ write: (msg) => void } 兼容 morgan 的 stream.write 约定）
//   - write：通用追加写（errorHandler / 进程级 fatal 用）
// 按天轮转：文件名 access-YYYY-MM-DD.log / error-YYYY-MM-DD.log，跨天自动切换新文件。
// 打开失败（如目录权限）静默降级到 console —— 日志绝不能拖垮业务。
const fs = require('fs')
const path = require('path')

function createLogWriter(dir, prefix) {
  fs.mkdirSync(dir, { recursive: true })
  let currentDate = null
  let fd = null

  function dayFile() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${prefix}-${y}-${m}-${day}.log`
  }

  function ensureFd() {
    const file = dayFile()
    if (currentDate === file && fd) return fd
    currentDate = file
    if (fd) { try { fs.closeSync(fd) } catch (e) { /* ignore */ } }
    fd = null
    try { fd = fs.openSync(path.join(dir, file), 'a') } catch (e) { /* 降级 console */ }
    return fd
  }

  return {
    stream: {
      write: (msg) => { try { const f = ensureFd(); if (f) fs.writeSync(f, msg) } catch (e) { /* ignore */ } },
    },
    write: (line) => { try { const f = ensureFd(); if (f) fs.writeSync(f, line) } catch (e) { /* ignore */ } },
  }
}

module.exports = { createLogWriter }
