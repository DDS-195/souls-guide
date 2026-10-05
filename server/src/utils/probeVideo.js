const { spawn } = require('child_process')

module.exports = function probeVideo(inputPath, { spawnProcess = spawn, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', inputPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let settled = false
    const finish = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(value)
    }
    const terminate = message => {
      finish(new Error(message))
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => terminate('视频检测超时，请更换文件后重试'), timeoutMs)
    child.stdout.on('data', chunk => {
      if (settled) return
      stdout += chunk
      if (Buffer.byteLength(stdout) > 1024 * 1024) terminate('视频检测结果过大')
    })
    // Drain stderr without retaining server paths or decoder diagnostics in user-facing errors.
    child.stderr.on('data', () => {})
    child.on('error', err => finish(err.code === 'ENOENT' ? null : new Error('视频检测暂时不可用'), null))
    child.on('close', code => {
      if (settled) return
      if (code !== 0) return finish(new Error('视频文件无法解析'))
      try { finish(null, JSON.parse(stdout)) } catch { finish(new Error('视频检测结果不合法')) }
    })
  })
}
