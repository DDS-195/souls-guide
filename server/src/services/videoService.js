// 视频分片上传核心逻辑：断点续传状态 / 分片落盘 / 合并 / FFmpeg 检测式转码
// 契约见设计文档 4.1 媒体模块 + 10.2/10.3 节（D12）；路径基于 __dirname 解析，不依赖 cwd
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { pipeline } = require('stream/promises')
const { ALLOWED_EXT, MAX_TOTAL_CHUNKS } = require('../utils/videoUpload')

const HASH_RE = /^[a-f0-9]{32}$/ // spark-md5 32 位 hex，防路径穿越
const DONE_FILE = '__done__' // 合并完成标记（内容为最终 URL）
const STALE_TMP_MS = 7 * 24 * 3600 * 1000 // 过期 tmp 目录清理阈值：7 天
const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000 // 转码超时：15 分钟

const SERVER_ROOT = path.join(__dirname, '..', '..')
const TMP_ROOT = () => path.join(SERVER_ROOT, 'uploads', 'videos', 'tmp')
const VIDEO_ROOT = () => path.join(SERVER_ROOT, 'uploads', 'videos')

function chunkDir(hash) {
  return path.join(TMP_ROOT(), hash)
}

function chunkPath(hash, index) {
  return path.join(chunkDir(hash), String(index).padStart(4, '0'))
}

// 磁盘绝对路径 → URL：相对 server 根（express.static('uploads') 的根），如 /uploads/videos/2026/08/x.mp4
function toUrl(absPath) {
  return '/' + path.relative(SERVER_ROOT, absPath).split(path.sep).join('/')
}

// 从 originalName 提取扩展名（白名单校验）；不传默认 .mp4，白名单外返回 null
function pickExt(originalName) {
  if (!originalName) return '.mp4'
  const raw = path.extname(String(originalName).split('?')[0]).toLowerCase()
  return ALLOWED_EXT.includes(raw) ? raw : null
}

// ---- FFmpeg 检测式转码（10.3）----

// 可用性缓存（null=未检测）；只缓存「可用」结果：
// spawn error 或 exit != 0 不缓存，部署服务器后装好 FFmpeg 下次合并自动启用，无需重启进程
let ffmpegAvailable = null
function checkFfmpeg() {
  if (ffmpegAvailable === true) return Promise.resolve(true)
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
    p.on('error', () => {
      resolve(false)
    })
    p.on('close', (code) => {
      if (code === 0) ffmpegAvailable = true
      resolve(code === 0)
    })
  })
}

function runFfmpeg(args, timeoutMs = TRANSCODE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' })
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      reject(new Error('视频转码超时'))
    }, timeoutMs)
    p.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`视频转码失败（ffmpeg exit ${code}）`))
    })
  })
}

// 转码为 H.264 MP4（同目录同名 .mp4）：≤1080p / 2000kbps 视频 / ≤30fps / AAC 128k
async function transcodeToMp4(inputPath) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.mp4')
  await runFfmpeg([
    '-i', inputPath,
    '-c:v', 'libx264',
    '-vf', 'scale=min(1920,iw):-2',
    '-b:v', '2000k',
    '-r', '30',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-y', outputPath,
  ])
  return outputPath
}

// ---- 分片状态 / 落盘 ----

// 已上传分片 index 列表（忽略 __done__ 标记），供断点续传
async function listUploadedChunks(hash) {
  if (!HASH_RE.test(hash)) return []
  try {
    const files = await fsp.readdir(chunkDir(hash))
    return files
      .filter((f) => f !== DONE_FILE)
      .map((f) => parseInt(f, 10))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// 合并完成后的最终 URL（__done__ 内容）；未完成返回 null
async function findDoneUrl(hash) {
  if (!HASH_RE.test(hash)) return null
  try {
    return (await fsp.readFile(path.join(chunkDir(hash), DONE_FILE), 'utf8')) || null
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

// 落盘单个分片（幂等：已存在直接覆盖，支持断点续传重传）
async function saveChunk(hash, index, buffer) {
  if (!HASH_RE.test(hash)) throw new Error('hash 参数不合法')
  if (!Number.isInteger(index) || index < 0 || index >= MAX_TOTAL_CHUNKS) throw new Error('分片序号不合法')
  if (!buffer || !buffer.length) throw new Error('分片内容为空')
  await fsp.mkdir(chunkDir(hash), { recursive: true })
  await fsp.writeFile(chunkPath(hash, index), buffer)
}

// ---- 合并 ----

// A4 并发加固（2026-08-13）：同 hash 的并发 merge 串行化——复用进行中的 Promise，
// 杜绝「一个请求清理分片时另一个还在流式读」的竞态；失败后锁自动释放，断点续传可重试
const merging = new Map() // hash -> Promise<url>
function mergeChunks(hash, totalChunks, originalName) {
  const pending = merging.get(hash)
  if (pending) return pending // 并发重复 merge 直接复用同一结果（同 URL）
  const p = doMerge(hash, totalChunks, originalName).finally(() => { merging.delete(hash) })
  merging.set(hash, p)
  return p
}

// 校验分片完整性 → 流式合并至 uploads/videos/YYYY/MM/ → 转码 → 写 __done__ → 清理
async function doMerge(hash, totalChunks, originalName) {
  if (!HASH_RE.test(hash)) throw new Error('hash 参数不合法')
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_TOTAL_CHUNKS) {
    throw new Error('分片数量不合法（1~100）')
  }
  const ext = pickExt(originalName)
  if (!ext) throw new Error('不支持的视频格式')

  // 完整性校验：0..totalChunks-1 全部存在
  const uploaded = await listUploadedChunks(hash)
  for (let i = 0; i < totalChunks; i++) {
    if (!uploaded.includes(i)) throw new Error(`分片不完整，缺少第 ${i + 1} 片，请断点续传`)
  }

  // 最终文件路径（服务端生成，不使用用户原始文件名）
  const now = new Date()
  const dir = path.join(VIDEO_ROOT(), String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'))
  await fsp.mkdir(dir, { recursive: true })
  const finalPath = path.join(dir, `${now.getTime()}-${crypto.randomBytes(8).toString('hex')}${ext}`)

  // 按序流式合并
  const out = fs.createWriteStream(finalPath)
  try {
    for (let i = 0; i < totalChunks; i++) {
      await pipeline(fs.createReadStream(chunkPath(hash, i)), out, { end: false })
    }
    out.end()
    await new Promise((resolve, reject) => {
      out.on('finish', resolve)
      out.on('error', reject)
    })
  } catch (err) {
    out.destroy()
    await fsp.unlink(finalPath).catch(() => {})
    throw new Error(`合并失败：${err.message}`)
  }

  // 检测式转码：原始扩展名非 .mp4 且 FFmpeg 可用 → 转 H.264 MP4，成功删除原始文件
  let url
  if (ext !== '.mp4' && (await checkFfmpeg())) {
    try {
      const mp4Path = await transcodeToMp4(finalPath)
      await fsp.unlink(finalPath)
      url = toUrl(mp4Path)
      console.log(`[video] 转码完成 ${mp4Path}`)
    } catch (err) {
      console.warn(`[video] 转码失败，保留原文件：${err.message}`)
      url = toUrl(finalPath)
    }
  } else {
    if (ext !== '.mp4') {
      console.warn('[video] FFmpeg 不可用，未转码（部署服务器安装后自动启用）')
    }
    url = toUrl(finalPath)
  }

  // 写 __done__ 标记（status 再次查询可直接返回 url）+ 清理本 hash 分片 + 清理过期 tmp
  await fsp.mkdir(chunkDir(hash), { recursive: true })
  await fsp.writeFile(path.join(chunkDir(hash), DONE_FILE), url, 'utf8')
  for (const f of await listUploadedChunks(hash)) {
    await fsp.unlink(chunkPath(hash, f)).catch(() => {})
  }
  cleanupStaleTmp().catch(() => {})

  return url
}

// 清理 7 天前的过期 tmp 目录（分片残留，fire-and-forget）
async function cleanupStaleTmp() {
  const entries = await fsp.readdir(TMP_ROOT()).catch(() => [])
  for (const name of entries) {
    const full = path.join(TMP_ROOT(), name)
    const st = await fsp.stat(full).catch(() => null)
    if (st && st.isDirectory() && Date.now() - st.mtimeMs > STALE_TMP_MS) {
      await fsp.rm(full, { recursive: true, force: true }).catch(() => {})
    }
  }
}

module.exports = { listUploadedChunks, findDoneUrl, saveChunk, mergeChunks }
