// Public network acceptance, sequential requests only: no fake views or interactions.
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const assert=require('node:assert/strict')
const sharp=require('../../server/node_modules/sharp')
const root=path.resolve(__dirname,'../..'), dir=path.join(root,'.artifacts/content-20261004')
const payload=JSON.parse(fs.readFileSync(path.join(dir,'payload.json'),'utf8'))
const receipt=JSON.parse(fs.readFileSync(path.join(dir,'receipt.json'),'utf8'))
const base='http://116.62.158.251'
const sha=data=>crypto.createHash('sha256').update(data).digest('hex')
let requests=0
async function request(url,options={}) {
  // Keep traffic well below the deployed public rate limit.
  await new Promise(resolve=>setTimeout(resolve,120))
  requests++
  return fetch(base+url,{...options,signal:AbortSignal.timeout(20000)})
}
async function json(url) {
  const response=await request(url); assert.equal(response.status,200,url)
  const result=await response.json();assert.equal(result.code,0,url)
  return result.data
}
async function main() {
  const homepage=await request('/');assert.equal(homepage.status,200);assert.ok((await homepage.text()).includes('SoulsGuide'))
  const games=await json('/api/games');assert.equal(games.length,19)
  const all=await json('/api/posts?pageSize=50');assert.equal(all.total,36);assert.equal(all.list.length,36)
  for(const draft of payload.games) {
    const data=await json('/api/posts?game_id='+receipt.gameIds[draft.key]);assert.equal(data.total,2)
  }
  for(const draft of [...payload.existing,...payload.posts]) {
    const id=draft.id || receipt.created.find(e=>e.key===draft.key).id
    const detail=await json('/api/posts/'+id)
    assert.equal(detail.title,draft.title);assert.equal(detail.content,draft.content)
    assert.deepEqual(detail.guide_info,draft.guide_info)
    for(const tag of draft.tags) assert.ok(detail.tags.some(t=>(typeof t==='string'?t:t.name)===tag))
  }
  const covers=[]
  for(const asset of payload.assets) {
    const url='/uploads/images/sg-library-20261004/'+asset.file
    const response=await request(url);assert.equal(response.status,200,url)
    assert.match(response.headers.get('content-type'),/^image\/webp/)
    const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),asset.sha256)
    const original=await sharp(bytes).metadata();assert.equal(original.width,1200);assert.equal(original.height,675)
    const thumbnailResponse=await request(url+'?w=480');assert.equal(thumbnailResponse.status,200)
    const thumbnail=Buffer.from(await thumbnailResponse.arrayBuffer()), info=await sharp(thumbnail).metadata()
    assert.equal(info.width,480);assert.equal(info.format,'webp')
    covers.push({file:asset.file,originalBytes:bytes.length,thumbnailBytes:thumbnail.length})
  }
  const videos=[]
  for(const id of [2,4,12]) {
    const detail=await json('/api/posts/'+id)
    const media=detail.media.find(m=>m.type==='video');assert.ok(media,`post ${id} lost video`)
    const response=await request(media.url,{headers:{Range:'bytes=0-1023'}})
    assert.equal(response.status,206,media.url);assert.match(response.headers.get('content-range'),/^bytes 0-1023\//)
    const data=await response.arrayBuffer();assert.equal(data.byteLength,1024)
    videos.push({postId:id,url:media.url,rangeStatus:response.status})
  }
  const result={checkedAt:new Date().toISOString(),base,requests,games:19,publishedPosts:36,
    newGameFiltersChecked:12,articleDetailsChecked:36,originalCoversChecked:24,thumbnailsChecked:24,
    videosChecked:3,totalOriginalBytes:covers.reduce((s,c)=>s+c.originalBytes,0),
    totalThumbnailBytes:covers.reduce((s,c)=>s+c.thumbnailBytes,0),covers,videos}
  fs.writeFileSync(path.join(dir,'verification-http.json'),JSON.stringify(result,null,2))
  console.log('HTTP_ACCEPTANCE_OK='+JSON.stringify({...result,covers:undefined,videos:undefined}))
}
main().catch(e=>{console.error(e.stack);process.exitCode=1})
