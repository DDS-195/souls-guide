// Read-only public acceptance: no view, interaction or content writes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'client/dist')
const base = 'http://116.62.158.251'
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function get(url) {
  const response = await fetch(base + url, { signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200, url)
  return Buffer.from(await response.arrayBuffer())
}
async function api(url) {
  const response = JSON.parse(await get(url))
  assert.equal(response.code, 0, url)
  return response.data
}
async function main() {
  const expected = JSON.parse(fs.readFileSync(path.join(dist, 'release.json')))
  const release = JSON.parse(await get('/release.json'))
  assert.equal(release.release, expected.release)
  assert.equal(release.sourceSha256, expected.sourceSha256)
  assert.equal(sha(await get('/')), sha(fs.readFileSync(path.join(dist, 'index.html'))))
  const assets = fs.readdirSync(path.join(dist, 'assets')).filter(name =>
    /^(VideoCoverBadge|PostCard|Home|MyLists|Search|UserProfile|index)-.+\.(js|css)$/.test(name))
  for (const asset of assets) {
    assert.equal(sha(await get('/assets/' + asset)), sha(fs.readFileSync(path.join(dist, 'assets', asset))), asset)
  }
  const all = await api('/api/posts?pageSize=50')
  assert.equal(all.list.length, all.total, 'expected dataset fits one read-only request')
  const videoIds = []
  for (const post of all.list) {
    assert.equal(typeof post.has_video, 'boolean')
    assert.ok(!Object.hasOwn(post, 'media'), 'summary must not return video URLs or preload videos')
    const detail = await api('/api/posts/' + post.id)
    const videos = detail.media.filter(media => media.type === 'video')
    assert.equal(post.has_video, videos.length > 0, 'video flag disagrees with article ' + post.id)
    if (videos.length) {
      videoIds.push(post.id)
      for (const video of videos) {
        const response = await fetch(base + video.url, {
          headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000),
        })
        assert.equal(response.status, 206, 'existing video range playback')
        assert.match(response.headers.get('content-range'), /^bytes 0-1023\/\d+$/)
        assert.equal((await response.arrayBuffer()).byteLength, 1024)
      }
    }
  }
  assert.deepEqual(videoIds.sort((a, b) => a - b), [2, 4, 12])
  const pages = [], ids = []
  for (let page = 1; page <= Math.ceil(all.total / 15); page++) {
    const data = await api(`/api/posts?page=${page}&pageSize=15`)
    assert.equal(data.total, all.total)
    assert.equal(data.pageSize, 15)
    assert.equal(data.list.length, Math.min(15, all.total - (page - 1) * 15))
    pages.push(data.list.length)
    ids.push(...data.list.map(post => post.id))
  }
  assert.equal(ids.length, new Set(ids).size, 'pagination duplicates')
  assert.equal(ids.length, all.total, 'pagination missing posts')
  const game = await api('/api/posts?game_id=7&pageSize=50')
  assert.equal(game.list.length, game.total)
  assert.equal(game.list.find(post => post.id === 12).has_video, true)
  const selected = await api('/api/posts?ids=1,2,4,12')
  assert.equal(selected.total, 4)
  assert.ok(selected.list.every(post => post.has_video === (post.id !== 1)))
  const sample = all.list.find(post => post.id === 12)
  const keyword = await api('/api/posts?keyword=' + encodeURIComponent(sample.title) + '&pageSize=50')
  assert.equal(keyword.list.length, keyword.total)
  assert.ok(keyword.list.some(post => post.id === 12 && post.has_video))
  const result = {
    checkedAt: new Date().toISOString(), release: release.release, sourceSha256: release.sourceSha256,
    matchedFrontendAssets: assets.length, checkedPosts: all.total, videoPostIds: videoIds,
    pageLengths: pages, gameAndKeywordAndIdsFilters: true, existingVideoRangePlayback: true,
    verificationDidNotRecordViews: true,
  }
  fs.writeFileSync(path.join(root, '.artifacts/video-badge-verification.json'), JSON.stringify(result, null, 2))
  console.log('VIDEO_BADGE_PUBLIC_OK=' + JSON.stringify(result))
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
