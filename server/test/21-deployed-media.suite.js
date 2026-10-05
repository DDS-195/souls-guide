const H = require('./helpers')
const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const probe = require('../src/utils/probeVideo')

module.exports = async function () {
  await H.test('响应式图片固定尺寸、条件缓存及下架权限', async () => {
    const owner = await H.mkUser('variant_owner', { role: 'creator' })
    const url = `/uploads/images/variant-${crypto.randomBytes(8).toString('hex')}.png`
    const filename = path.join(__dirname, '..', url.slice(1))
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await require('sharp')({ create: { width: 1600, height: 900, channels: 3, background: '#987654' } }).png().toFile(filename)
    H.created.files.push(filename)
    const post = await H.mkPost(owner, { status: 'published', cover: url })
    const endpoint = 'http://127.0.0.1:3199' + url
    const r = await fetch(endpoint + '?w=480')
    H.assert.equal(r.status, 200)
    H.assert.equal(r.headers.get('content-type'), 'image/webp')
    H.assert.equal((await require('sharp')(Buffer.from(await r.arrayBuffer())).metadata()).width, 480)
    const middle = await fetch(endpoint + '?w=640')
    H.assert.equal(middle.status, 200)
    H.assert.equal((await require('sharp')(Buffer.from(await middle.arrayBuffer())).metadata()).width, 640)
    const tablet = await fetch(endpoint + '?w=960')
    H.assert.equal(tablet.status, 200)
    H.assert.equal((await require('sharp')(Buffer.from(await tablet.arrayBuffer())).metadata()).width, 960)
    const etag = r.headers.get('etag'); H.assert.ok(etag)
    H.assert.equal((await fetch(endpoint + '?w=480', { cache: 'no-cache', headers: { 'If-None-Match': etag } })).status, 304)
    H.assert.equal((await fetch(endpoint + '?w=999')).status, 400)
    H.assert.equal((await fetch('http://127.0.0.1:3199/uploads/_derived/test.webp')).status, 404)
    await H.pool.execute("UPDATE posts SET status='rejected' WHERE id=?", [post])
    H.assert.equal((await fetch(endpoint + '?w=640')).status, 404)
    H.assert.equal((await fetch(endpoint + '?w=960')).status, 404)
    H.assert.equal((await fetch(endpoint + '?w=480', { headers: { 'If-None-Match': etag } })).status, 404)
  })
  await H.test('真实视频分片上传、ffprobe检测、转码和私有Range读取', async () => {
    const filename = path.join(__dirname, '../uploads', 'probe-' + crypto.randomBytes(8).toString('hex') + '.webm')
    await fs.mkdir(path.dirname(filename), { recursive: true })
    H.created.files.push(filename)
    try {
      await require('util').promisify(require('child_process').execFile)('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-filter_complex_threads', '1',
        '-threads', '1', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10',
        '-t', '0.3', '-c:v', 'libvpx', '-threads', '1', '-y', filename,
      ], { timeout: 30000 })
    } catch (error) {
      throw new Error(`fixture ffmpeg code=${error.code} signal=${error.signal} killed=${error.killed}: ${error.stderr || error.message}`)
    }
    const payload = await fs.readFile(filename)
    const hash = crypto.createHash('md5').update(payload).digest('hex')
    const owner = await H.mkUser('real_video', { role: 'creator' })
    H.created.dirs.push(H.urlToAbs(`/uploads/videos/tmp/${owner}-${hash}`))
    const token = H.makeToken(owner, 'real_video', 'creator')
    const form = new FormData()
    form.append('hash', hash); form.append('index', '0'); form.append('totalChunks', '1')
    form.append('chunk', new File([payload], 'probe.webm', { type: 'video/webm' }))
    H.assert.equal((await H.http('POST', '/media/upload/video/chunk', { token, form })).status, 200)
    const previous = process.env.SKIP_MEDIA_PROBE
    try {
      process.env.SKIP_MEDIA_PROBE = 'false'
      const merged = await H.http('POST', '/media/upload/video/merge', { token, body: { hash, totalChunks: 1, originalName: 'probe.webm' } })
      H.assert.equal(merged.status, 200, merged.data?.message)
      const url = H.trackFile(merged.data.data.url)
      const metadata = await probe(H.urlToAbs(url))
      H.assert.equal(metadata.streams.find(s => s.codec_type === 'video').codec_name, 'h264')
      H.assert.equal(metadata.streams.find(s => s.codec_type === 'video').width, 160, '小视频不能被放大至1080p')
      H.assert.equal(metadata.streams.find(s => s.codec_type === 'video').height, 90)
      const res = await fetch('http://127.0.0.1:3199' + url, { headers: { Cookie: 'sg_media=' + merged.headers['x-media-grant'], Range: 'bytes=0-15' } })
      H.assert.equal(res.status, 206)
      H.assert.equal((await res.arrayBuffer()).byteLength, 16)
      H.assert.equal((await fetch('http://127.0.0.1:3199' + url)).status, 404)
    } finally {
      if (previous === undefined) delete process.env.SKIP_MEDIA_PROBE
      else process.env.SKIP_MEDIA_PROBE = previous
    }
  })
  await H.test('ffprobe超时与输出过大杀死子进程，正常结果可解析', async () => {
    const fake = () => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.kill = signal => { child.killed = signal }
      return child
    }
    let child = fake()
    await H.assert.rejects(probe('test', { spawnProcess: () => child, timeoutMs: 10 }), /超时/)
    H.assert.equal(child.killed, 'SIGKILL')
    child.emit('close', 0) // Late exit must not settle twice.
    child = fake()
    const oversized = probe('test', { spawnProcess: () => child })
    child.stdout.emit('data', 'x'.repeat(1024 * 1024 + 1))
    await H.assert.rejects(oversized, /过大/)
    H.assert.equal(child.killed, 'SIGKILL')
    child = fake()
    const normal = probe('test', { spawnProcess: () => child })
    child.stdout.emit('data', '{"streams":[]}'); child.emit('close', 0)
    H.assert.deepEqual(await normal, { streams: [] })
  })

  await H.test('媒体按发布状态与所有权鉴权，支持Range，预览凭证不能调用API', async () => {
    const owner = await H.mkUser('media_owner', { role: 'creator' })
    const other = await H.mkUser('media_other', { role: 'creator' })
    const url = `/uploads/images/access-${crypto.randomBytes(8).toString('hex')}.png`
    const filename = path.join(__dirname, '..', url.slice(1))
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, Buffer.from('0123456789'))
    H.created.files.push(filename)
    const asset = await require('../src/services/assetService').registerUpload(owner, { url, type: 'image' })
    const getGrant = async id => {
      const response = await H.http('GET', '/users/me', { token: H.makeToken(id, 'test', 'creator') })
      return response.headers['x-media-grant']
    }
    const ownerGrant = await getGrant(owner), otherGrant = await getGrant(other)
    const admin = await H.http('GET', '/users/me', { token: await H.adminToken() })
    const read = (grant, headers = {}) => fetch('http://127.0.0.1:3199' + url, { cache: 'no-cache', headers: { ...headers, ...(grant ? { Cookie: 'sg_media=' + grant } : {}) } })
    H.assert.equal((await read()).status, 404)
    H.assert.equal((await read(otherGrant)).status, 404)
    H.assert.equal((await read(admin.headers['x-media-grant'])).status, 200)
    const range = await read(ownerGrant, { Range: 'bytes=2-5' })
    H.assert.equal(range.status, 206); H.assert.equal(await range.text(), '2345')
    H.assert.match(range.headers.get('cache-control'), /no-store/)
    H.assert.equal((await H.http('GET', '/users/me', { token: ownerGrant })).status, 401)
    const post = await H.mkPost(owner, { status: 'pending', cover: url })
    await H.pool.execute('INSERT INTO post_assets(post_id,asset_id,usage_type) VALUES(?,?,?)', [post, asset.id, 'cover'])
    await H.pool.execute("UPDATE upload_assets SET status='attached' WHERE id=?", [asset.id])
    H.assert.equal((await read()).status, 404)
    await H.pool.execute("UPDATE posts SET status='published' WHERE id=?", [post])
    const publicResponse = await read()
    H.assert.equal(publicResponse.status, 200)
    H.assert.match(publicResponse.headers.get('cache-control'), /private, no-cache/)
    const etag = publicResponse.headers.get('etag')
    H.assert.ok(etag)
    H.assert.equal((await read(null, { 'If-None-Match': etag })).status, 304)
    await H.pool.execute("UPDATE posts SET status='rejected' WHERE id=?", [post])
    H.assert.equal((await read()).status, 404)
    H.assert.equal((await read(null, { 'If-None-Match': etag })).status, 404)
    await H.pool.execute('UPDATE users SET token_version=token_version+1 WHERE id=?', [owner])
    H.assert.equal((await read(ownerGrant)).status, 404)
    const newerGrant = await getGrant(other)
    await H.pool.execute('UPDATE users SET status=0 WHERE id=?', [other])
    H.assert.equal((await read(newerGrant)).status, 404)
  })

  await H.test('清理重试进程中断留下的deleted资源，已绑定资源不误删', async () => {
    const owner = await H.mkUser('cleanup_retry', { role: 'creator' })
    const assets = require('../src/services/assetService')
    const cleanup = require('../src/services/cleanupService')
    const url = `/uploads/images/retry-${crypto.randomBytes(8).toString('hex')}.png`
    const filename = path.join(__dirname, '..', url.slice(1))
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, 'test')
    H.created.files.push(filename)
    const asset = await assets.registerUpload(owner, { url, type: 'image' })
    await H.pool.execute("UPDATE upload_assets SET status='deleted' WHERE id=?", [asset.id])
    await cleanup.cleanupExpiredAssets({ assetIds: [asset.id] })
    await H.assert.rejects(fs.access(filename), { code: 'ENOENT' })
    const [[count]] = await H.pool.execute('SELECT COUNT(*) AS n FROM upload_assets WHERE id=?', [asset.id])
    H.assert.equal(count.n, 0)
    await fs.writeFile(filename, 'test')
    const attached = await assets.registerUpload(owner, { url, type: 'image' })
    const post = await H.mkPost(owner, { cover: url })
    await H.pool.execute('INSERT INTO post_assets(post_id,asset_id,usage_type) VALUES(?,?,?)', [post, attached.id, 'cover'])
    await H.pool.execute("UPDATE upload_assets SET status='deleted' WHERE id=?", [attached.id])
    await cleanup.cleanupExpiredAssets({ assetIds: [attached.id] })
    await fs.access(filename)
  })
}
