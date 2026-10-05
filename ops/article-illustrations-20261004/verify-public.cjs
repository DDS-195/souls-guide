// Non-mutating public verification: never calls the view-count or interaction endpoints.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const payload = require('./payload.json')
const before = require('../../.artifacts/article-illustrations-20261004/posts-before.json')
const base = process.env.SG_PUBLIC_ORIGIN || 'http://116.62.158.251'
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function request(url,options={}) {
  const response = await fetch(new URL(url,base),{signal:AbortSignal.timeout(30000),...options})
  assert.ok(response.ok, `${url}: HTTP ${response.status}`)
  return response
}
async function main() {
  const checked=[],videos=[],issues=[]
  for(const p of payload.posts) {
    try {
      const envelope = await (await request(`/api/posts/${p.id}`)).json(),post = envelope.data
      assert.ok(post,`missing article ${p.id}`)
      assert.equal(post.content,p.content);assert.equal(post.content_version,p.expectedVersion+1);assert.equal(post.status,'published')
      assert.equal(post.title,p.title);assert.equal(post.cover,p.cover);assert.equal(post.user_id,p.owner);assert.equal(post.game_id,p.gameId);assert.equal(post.published_at,p.publishedAt)
      const old = before.posts.find(r=>r.id===p.id)
      assert.deepEqual(post.guide_info,old.guide_info);assert.deepEqual([...post.tags].sort(),[...old.tags].sort())
      assert.deepEqual(post.media.filter(m=>m.type==='video'),p.expectedMedia.filter(m=>m.type==='video'))
      const images=post.media.filter(m=>m.type==='image');assert.equal(images.length,1);assert.equal(images[0].url,p.url)
      assert.equal((post.content.match(/<img\b/gi)||[]).length,1)
      const image = await request(p.url), bytes=Buffer.from(await image.arrayBuffer())
      assert.ok(image.headers.get('content-type')?.includes('image/webp'));assert.equal(sha(bytes),p.sha256);assert.equal(bytes.length,p.bytes)
      const cover = await request(p.cover,{method:'HEAD'});assert.ok(Number(cover.headers.get('content-length'))>0)
      for(const video of p.expectedMedia.filter(m=>m.type==='video')) {
        const response=await request(video.url,{headers:{Range:'bytes=0-31'}});assert.equal(response.status,206);assert.ok(response.headers.get('content-range')?.startsWith('bytes 0-31/'));assert.equal((await response.arrayBuffer()).byteLength,32);videos.push({postId:p.id,url:video.url,status:206})
      }
      checked.push({id:p.id,title:p.title,imageUrl:p.url,bytes:p.bytes,sha256:p.sha256,contentVersion:post.content_version})
    } catch(e) {issues.push({id:p.id,error:e.message})}
  }
  const result={verifiedAt:new Date().toISOString(),origin:base,checked:checked.length,bodyImages:checked.length,videoRanges:videos.length,images:checked,videos,issues}
  fs.writeFileSync(path.resolve(__dirname,'../../.artifacts/article-illustrations-20261004/public-verification.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({checked:result.checked,bodyImages:result.bodyImages,videoRanges:result.videoRanges,totalImageBytes:checked.reduce((n,p)=>n+p.bytes,0),issues}))
  assert.equal(checked.length,36);assert.equal(videos.length,3);assert.deepEqual(issues,[])
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
