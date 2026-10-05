const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'client/dist')
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
async function get(route) {
  const response = await fetch('http://116.62.158.251' + route, { signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200, route)
  return Buffer.from(await response.arrayBuffer())
}
async function main() {
  const expected = JSON.parse(fs.readFileSync(path.join(dist, 'release.json')))
  const release = JSON.parse(await get('/release.json'))
  assert.equal(release.release, expected.release)
  assert.equal(release.sourceSha256, expected.sourceSha256)
  assert.equal(sha(await get('/')), sha(fs.readFileSync(path.join(dist, 'index.html'))))
  const assets = fs.readdirSync(path.join(dist, 'assets')).filter(name => /^(Home|index|PostCard|VideoCoverBadge)-.+\.(js|css)$/.test(name))
  for (const name of assets) assert.equal(sha(await get('/assets/' + name)), sha(fs.readFileSync(path.join(dist, 'assets', name))))
  const capacities = []
  for (const pageSize of [15, 16, 18]) {
    const ids = [], pageLengths = []
    let total = Infinity
    for (let page = 1; page <= Math.ceil(total / pageSize); page++) {
      const response = JSON.parse(await get(`/api/posts?page=${page}&pageSize=${pageSize}`))
      assert.equal(response.code, 0)
      total = response.data.total
      assert.equal(response.data.pageSize, pageSize)
      assert.equal(response.data.list.length, Math.min(pageSize, total - (page - 1) * pageSize))
      assert.ok(response.data.list.every(post => typeof post.has_video === 'boolean'))
      ids.push(...response.data.list.map(post => post.id))
      pageLengths.push(response.data.list.length)
    }
    assert.equal(ids.length, total)
    assert.equal(new Set(ids).size, total)
    capacities.push({ pageSize, total, pageLengths })
  }
  const filtered = JSON.parse(await get('/api/posts?game_id=7&pageSize=16'))
  assert.equal(filtered.code, 0)
  assert.equal(filtered.data.list.length, filtered.data.total)
  assert.equal(filtered.data.list.find(post => post.id === 12).has_video, true)
  const result = { checkedAt: new Date().toISOString(), release: release.release, sourceSha256: release.sourceSha256, matchedAssets: assets.length, capacities, filteredVideoFlag: true }
  fs.writeFileSync(path.join(root, '.artifacts/responsive-home-verification.json'), JSON.stringify(result, null, 2))
  console.log('RESPONSIVE_HOME_PUBLIC_OK=' + JSON.stringify(result))
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
