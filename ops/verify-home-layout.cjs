// Public acceptance of the frontend-only home layout release.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),dist=path.join(root,'client/dist'),base='http://116.62.158.251'
const sha=data=>crypto.createHash('sha256').update(data).digest('hex')
async function get(url) {
  const response=await fetch(base+url,{signal:AbortSignal.timeout(15000)})
  assert.equal(response.status,200,url)
  return Buffer.from(await response.arrayBuffer())
}
async function main() {
  const expected=JSON.parse(fs.readFileSync(path.join(dist,'release.json')))
  const release=JSON.parse(await get('/release.json'))
  assert.equal(release.release,expected.release);assert.equal(release.sourceSha256,expected.sourceSha256)
  const html=await get('/');assert.equal(sha(html),sha(fs.readFileSync(path.join(dist,'index.html'))))
  const assets=fs.readdirSync(path.join(dist,'assets')).filter(name=>/^Home-.+\.js$|^index-.+\.(js|css)$/.test(name))
  for(const asset of assets) assert.equal(sha(await get('/assets/'+asset)),sha(fs.readFileSync(path.join(dist,'assets',asset))),asset)
  const cssName=assets.find(name=>name.startsWith('index-') && name.endsWith('.css'))
  const css=fs.readFileSync(path.join(dist,'assets',cssName),'utf8')
  assert.match(css,/\.main\.main--home\{padding-bottom:28px\}/)
  const pages=[],ids=[]
  let total
  for(let page=1;page<=3;page++) {
    const response=JSON.parse(await get(`/api/posts?page=${page}&pageSize=15`))
    assert.equal(response.code,0)
    const data=response.data
    total ??= data.total
    assert.equal(data.pageSize,15);assert.equal(data.total,total)
    assert.equal(data.list.length,Math.max(0,Math.min(15,total-(page-1)*15)))
    pages.push(data.list.length);ids.push(...data.list.map(p=>p.id))
  }
  assert.equal(ids.length,new Set(ids).size,'pagination duplicates')
  assert.equal(ids.length,total,'pagination missing posts')
  const game=JSON.parse(await get('/api/posts?game_id=19&pageSize=15'))
  assert.equal(game.code,0);assert.equal(game.data.total,2);assert.equal(game.data.list.length,2)
  const sample=JSON.parse(await get('/api/posts/36'))
  const cover=await get(sample.data.cover+'?w=480');assert.ok(cover.length>0)
  const result={checkedAt:new Date().toISOString(),release:release.release,sourceSha256:release.sourceSha256,
    frontendAssetsMatched:assets.length,pageSize:15,total,pageLengths:pages,uniquePosts:ids.length,
    desktopHomePaddingBottom:28,newGameFilter:true,sampleCoverAccessible:true}
  fs.writeFileSync(path.join(root,'.artifacts/home-layout-verification.json'),JSON.stringify(result,null,2))
  console.log('HOME_LAYOUT_PUBLIC_OK='+JSON.stringify(result))
}
main().catch(error=>{console.error(error.stack);process.exitCode=1})
