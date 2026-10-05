// 视频分片上传核心逻辑：断点续传状态 / 分片落盘 / 合并 / FFmpeg 检测式转码
// 契约见设计文档 4.1 媒体模块 + 10.2/10.3 节（D12）；路径基于 __dirname 解析，不依赖 cwd
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { pipeline } = require('stream/promises')
const { Readable } = require('stream')
const { ALLOWED_EXT, MAX_TOTAL_CHUNKS, MAX_CHUNK_SIZE, MAX_VIDEO_SIZE } = require('../utils/videoUpload')
const storageBudget = require('../utils/storageBudget')
const transcodes = require('../utils/workQueue')({ concurrency: Math.max(1, Number(process.env.MAX_TRANSCODE_CONCURRENCY) || 1) })

const HASH_RE = /^[a-f0-9]{32}$/ // spark-md5 32 位 hex，防路径穿越
const DONE_FILE = '__done__' // 合并完成标记（内容为最终 URL）
const OWNER_FILE = '__owner__' // 未完成分片会话所有者，防不同用户覆盖同 hash 分片
const STALE_TMP_MS = 7 * 24 * 3600 * 1000 // 过期 tmp 目录清理阈值：7 天
const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000 // 转码超时：15 分钟

const SERVER_ROOT = path.join(__dirname, '..', '..')
const TMP_ROOT = () => path.join(SERVER_ROOT, 'uploads', 'videos', 'tmp')
const VIDEO_ROOT = () => path.join(SERVER_ROOT, 'uploads', 'videos')

function chunkDir(hash, ownerId) {
  if (!HASH_RE.test(hash) || !Number.isSafeInteger(Number(ownerId)) || Number(ownerId) < 1) {
    throw Object.assign(new Error('上传会话参数不合法'), { statusCode: 400 })
  }
  return path.join(TMP_ROOT(), `${Number(ownerId)}-${hash}`)
}

async function sessionDir(hash, ownerId) {
  const current = chunkDir(hash, ownerId)
  if (await fsp.stat(current).catch(() => null)) return current
  // Existing uploads can resume after upgrading; never claim another owner's legacy directory.
  const legacy = path.join(TMP_ROOT(), hash)
  const owner = await fsp.readFile(path.join(legacy, OWNER_FILE), 'utf8').catch(() => null)
  return owner?.trim() === String(ownerId) ? legacy : current
}

function chunkPath(dir, index) {
  return path.join(dir, String(index).padStart(4, '0'))
}

// 磁盘绝对路径 → URL：相对 server 根（express.static('uploads') 的根），如 /uploads/videos/2026/08/x.mp4
function toUrl(absPath) {
  return '/' + path.relative(SERVER_ROOT, absPath).split(path.sep).join('/')
}

function fromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/videos/')) return null
  const abs = path.resolve(SERVER_ROOT, url.replace(/^\/+/, ''))
  return abs.startsWith(VIDEO_ROOT() + path.sep) ? abs : null
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

const runFfprobe = require('../utils/probeVideo')

function parseRate(value) {
  const [a, b = '1'] = String(value || '0').split('/').map(Number)
  return b ? a / b : 0
}

function needsTranscode(metadata, ext) {
  const video = (metadata.streams || []).find((stream) => stream.codec_type === 'video')
  if (!video) throw new Error('上传文件不包含视频轨道')
  const audio = (metadata.streams || []).find((stream) => stream.codec_type === 'audio')
  const format = String(metadata.format?.format_name || '')
  return ext !== '.mp4' || !format.includes('mp4') || video.codec_name !== 'h264' ||
    Number(video.width) > 1920 || Number(video.height) > 1080 || parseRate(video.avg_frame_rate || video.r_frame_rate) > 30 ||
    Boolean(audio && audio.codec_name !== 'aac')
}

// 转码为 H.264 MP4（同目录同名 .mp4）：≤1080p / 2000kbps 视频 / ≤30fps / AAC 128k
async function transcodeToMp4(inputPath, metadata) {
  const outputPath = inputPath.replace(/\.[^.]+$/, `.transcoded-${crypto.randomBytes(4).toString('hex')}.mp4`)
  try {
    await transcodes.run(() => runFfmpeg([
    '-i', inputPath,
    '-c:v', 'libx264',
    '-threads', '1',
    '-filter_threads', '1',
    '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-b:v', '2000k',
    '-r', '30',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-fs', String(MAX_VIDEO_SIZE),
    '-y', outputPath,
    ]))
    if ((await fsp.stat(outputPath)).size >= MAX_VIDEO_SIZE) throw new Error('转码后的视频超过500MB，请缩短视频后重试')
    const output = await runFfprobe(outputPath)
    const sourceDuration = Number(metadata?.format?.duration)
    const outputDuration = Number(output.format?.duration)
    if (Number.isFinite(sourceDuration) && sourceDuration > 0 &&
        (!Number.isFinite(outputDuration) || outputDuration < sourceDuration - Math.max(1, sourceDuration * .02))) {
      throw new Error('转码输出不完整或超过500MB，请缩短视频后重试')
    }
  } catch (err) {
    await fsp.unlink(outputPath).catch(() => {})
    throw err
  }
  return outputPath
}

async function md5File(filePath) {
  const hash = crypto.createHash('md5')
  await pipeline(fs.createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function assertUploadOwner(hash, ownerId, claim = false) {
  if (!Number.isInteger(Number(ownerId)) || Number(ownerId) < 1) throw new Error('上传会话用户不合法')
  const dir = await sessionDir(hash, ownerId)
  const ownerPath = path.join(dir, OWNER_FILE)
  if (claim) {
    await fsp.mkdir(dir, { recursive: true })
    try {
      await fsp.writeFile(ownerPath, String(ownerId), { flag: 'wx' })
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
  let actual
  try { actual = (await fsp.readFile(ownerPath, 'utf8')).trim() } catch (err) {
    if (err.code === 'ENOENT' && !claim) throw Object.assign(new Error('上传会话不存在，请重新上传'), { statusCode: 404 })
    throw err
  }
  if (actual !== String(ownerId)) throw Object.assign(new Error('无权访问该视频上传会话'), { statusCode: 403 })
  return dir
}

// ---- 分片状态 / 落盘 ----

// 已上传分片 index 列表（忽略 __done__ 标记），供断点续传
async function listUploadedChunks(hash, ownerId = null, claim = false) {
  if (!HASH_RE.test(hash)) return []
  const dir = await assertUploadOwner(hash, ownerId, claim)
  try {
    const files = await fsp.readdir(dir)
    return files
      .filter((f) => /^\d{4}$/.test(f))
      .map((f) => parseInt(f, 10))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// 合并完成后的最终 URL（__done__ 内容）；未完成返回 null
async function findDoneUrl(hash, ownerId) {
  if (!HASH_RE.test(hash)) return null
  try {
    const dir = await sessionDir(hash, ownerId)
    if (!(await fsp.stat(dir).catch(() => null))) return null
    await assertUploadOwner(hash, ownerId)
    const marker = path.join(dir, DONE_FILE)
    const url = (await fsp.readFile(marker, 'utf8')).trim()
    const abs = fromUrl(url)
    if (!abs || !(await fsp.stat(abs).catch(() => null))) {
      await fsp.unlink(marker).catch(() => {})
      return null
    }
    return url || null
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

// 落盘单个分片（幂等：已存在直接覆盖，支持断点续传重传）
async function saveChunk(hash, index, buffer, ownerId) {
  if (!HASH_RE.test(hash)) throw new Error('hash 参数不合法')
  if (!Number.isInteger(index) || index < 0 || index >= MAX_TOTAL_CHUNKS) throw new Error('分片序号不合法')
  if (!buffer || !buffer.length) throw new Error('分片内容为空')
  if (buffer.length > MAX_CHUNK_SIZE) throw new Error('单个分片不能超过5MB')
  const key = `${ownerId}:${hash}`
  if (merging.has(key)) throw Object.assign(new Error('视频正在合并，请稍后重试'), { statusCode: 409 })
  const pending = (writing.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const dir = await assertUploadOwner(hash, ownerId, true)
    const temporary = path.join(dir, `.incoming-${crypto.randomBytes(8).toString('hex')}`)
    try {
      await fsp.writeFile(temporary, buffer)
      await fsp.rename(temporary, chunkPath(dir, index))
    } finally { await fsp.unlink(temporary).catch(() => {}) }
  }).finally(() => { if (writing.get(key) === pending) writing.delete(key) })
  writing.set(key, pending)
  return pending
}

// ---- 合并 ----

// A4 并发加固（2026-08-13）：同 hash 的并发 merge 串行化——复用进行中的 Promise，
// 杜绝「一个请求清理分片时另一个还在流式读」的竞态；失败后锁自动释放，断点续传可重试
const merging = new Map() // owner:hash -> Promise<url>; independent of the HTTP connection
const writing = new Map() // atomic chunk writes finish before a merge begins reading
function mergeChunks(hash, totalChunks, originalName, ownerId) {
  const key = `${ownerId}:${hash}`
  try { chunkDir(hash, ownerId) } catch (err) { return Promise.reject(err) }
  const pending = merging.get(key)
  if (pending) return pending // 并发重复 merge 直接复用同一结果（同 URL）
  if (merging.size >= 3) return Promise.reject(Object.assign(new Error('视频处理繁忙，请稍后重试'), { statusCode: 503 }))
  const p = doMerge(hash, totalChunks, originalName, ownerId).finally(() => { merging.delete(key) })
  merging.set(key, p)
  return p
}

// 校验分片完整性 → 流式合并至 uploads/videos/YYYY/MM/ → 转码 → 写 __done__ → 清理
async function doMerge(hash, totalChunks, originalName, ownerId) {
  if (!HASH_RE.test(hash)) throw new Error('hash 参数不合法')
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_TOTAL_CHUNKS) {
    throw new Error('分片数量不合法（1~100）')
  }
  const ext = pickExt(originalName)
  if (!ext) throw new Error('不支持的视频格式')
  await writing.get(`${ownerId}:${hash}`)
  const session = await assertUploadOwner(hash, ownerId, false)
  const done = await findDoneUrl(hash, ownerId)
  if (done) return done

  // 完整性校验：0..totalChunks-1 全部存在
  const uploaded = await listUploadedChunks(hash, ownerId)
  for (let i = 0; i < totalChunks; i++) {
    if (!uploaded.includes(i)) throw new Error(`分片不完整，缺少第 ${i + 1} 片，请断点续传`)
  }
  const sizes = await Promise.all(Array.from({ length: totalChunks }, (_, i) => fsp.stat(chunkPath(session, i))))
  const bytes = sizes.reduce((sum, st) => sum + st.size, 0)
  if (bytes > MAX_VIDEO_SIZE || sizes.some(st => st.size > MAX_CHUNK_SIZE)) throw new Error('视频不能超过500MB，单片不能超过5MB')
  const releaseSpace = await storageBudget.reserve(bytes + MAX_VIDEO_SIZE)
  try {

  // 最终文件路径（服务端生成，不使用用户原始文件名）
  const now = new Date()
  const dir = path.join(VIDEO_ROOT(), String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'))
  await fsp.mkdir(dir, { recursive: true })
  const finalPath = path.join(dir, `${now.getTime()}-${crypto.randomBytes(8).toString('hex')}${ext}`)

  // 按序流式合并
  try {
    // One pipeline avoids accumulating listeners on a shared output for 100 chunks.
    const input = Readable.from((async function* () {
      for (let i = 0; i < totalChunks; i++) {
        for await (const data of fs.createReadStream(chunkPath(session, i))) yield data
      }
    })())
    await pipeline(input, fs.createWriteStream(finalPath))
  } catch (err) {
    await fsp.unlink(finalPath).catch(() => {})
    throw new Error(`合并失败：${err.message}`)
  }

  const serverHash = await md5File(finalPath)
  if (serverHash !== hash) {
    await fsp.unlink(finalPath).catch(() => {})
    throw new Error('文件完整性校验失败，请重新上传')
  }

  // ffprobe 按真实编码/分辨率/帧率判定，MP4 也可能需要转码；生产环境不允许工具缺失时静默降级。
  let url
  const skipProbe = process.env.NODE_ENV !== 'production' && process.env.SKIP_MEDIA_PROBE === 'true'
  let metadata = null
  if (!skipProbe) {
    try {
      metadata = await runFfprobe(finalPath)
    } catch (err) {
      await fsp.unlink(finalPath).catch(() => {})
      throw err
    }
  }
  const requireTools = process.env.NODE_ENV === 'production' || process.env.REQUIRE_MEDIA_TOOLS === 'true'
  if (!skipProbe && !metadata && requireTools) {
    await fsp.unlink(finalPath).catch(() => {})
    throw new Error('服务器缺少 ffprobe，无法验证视频格式')
  }
  let shouldTranscode
  try { shouldTranscode = metadata ? needsTranscode(metadata, ext) : ext !== '.mp4' }
  catch (err) { await fsp.unlink(finalPath).catch(() => {}); throw err }
  if (shouldTranscode) {
    if (!(await checkFfmpeg())) {
      if (requireTools) {
        await fsp.unlink(finalPath).catch(() => {})
        throw new Error('服务器缺少 FFmpeg，无法处理该视频')
      }
      console.warn('[video] FFmpeg 不可用，开发环境保留原始视频')
      url = toUrl(finalPath)
    } else {
      try {
        const mp4Path = await transcodeToMp4(finalPath, metadata)
        await fsp.unlink(finalPath)
        url = toUrl(mp4Path)
        console.log(`[video] 转码完成 ${mp4Path}`)
      } catch (err) {
        await fsp.unlink(finalPath).catch(() => {})
        throw err
      }
    }
  } else {
    url = toUrl(finalPath)
  }

  // 写 __done__ 标记（status 再次查询可直接返回 url）+ 清理本 hash 分片 + 清理过期 tmp
  await fsp.mkdir(session, { recursive: true })
  await fsp.writeFile(path.join(session, DONE_FILE), url, 'utf8')
  for (const f of await listUploadedChunks(hash, ownerId)) {
    await fsp.unlink(chunkPath(session, f)).catch(() => {})
  }
  cleanupStaleTmp().catch(() => {})

  return url
  } finally { releaseSpace() }
}

// 清理 7 天前的过期 tmp 目录（分片残留，fire-and-forget）
async function cleanupStaleTmp() {
  const entries = await fsp.readdir(TMP_ROOT()).catch(() => [])
  for (const name of entries) {
    if (!/^(?:\d+-)?[a-f0-9]{32}$/.test(name)) continue
    if ([...merging.keys()].some(key => name === key.replace(':', '-') || name === key.split(':')[1])) continue
    const full = path.join(TMP_ROOT(), name)
    const st = await fsp.stat(full).catch(() => null)
    if (st && st.isDirectory() && Date.now() - st.mtimeMs > STALE_TMP_MS) {
      await fsp.rm(full, { recursive: true, force: true }).catch(() => {})
    }
  }
}

async function clearDoneMarker(hash, expectedUrl = null, ownerId) {
  if (!HASH_RE.test(hash)) return false
  const marker = path.join(await sessionDir(hash, ownerId), DONE_FILE)
  if (expectedUrl) {
    const current = await fsp.readFile(marker, 'utf8').catch(() => null)
    if (current && current.trim() !== expectedUrl) return false
  }
  await fsp.unlink(marker).catch(() => {})
  return true
}

module.exports = { listUploadedChunks, findDoneUrl, saveChunk, mergeChunks, cleanupStaleTmp, clearDoneMarker }
