// Local-only image processing and payload preparation. Generated assets are never covers.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const sharp = require(path.join(root, 'server/node_modules/sharp'))
sharp.concurrency(1)
const out = path.join(root, 'assets/article-illustrations-20261004')
const artifacts = path.join(root, '.artifacts/article-illustrations-20261004')
const briefs = require('./briefs.json')
const before = require(path.join(artifacts, 'posts-before.json'))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const escape = s => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
async function main() {
  fs.mkdirSync(out, { recursive:true }); fs.mkdirSync(artifacts, { recursive:true })
  const results = []
  for (const brief of briefs) {
    const recordPath = path.join(__dirname, 'generated', `post-${String(brief.id).padStart(2,'0')}.json`)
    if (!fs.existsSync(recordPath)) continue
    const generated = JSON.parse(fs.readFileSync(recordPath,'utf8'))
    assert.equal(generated.id, brief.id); assert.ok(fs.existsSync(generated.source))
    const file = `post-${String(brief.id).padStart(2,'0')}.webp`
    const sourceBytes = fs.readFileSync(generated.source)
    const buffer = await sharp(sourceBytes).rotate().resize(1200,675,{fit:'cover',position:'attention'}).webp({quality:80,effort:5}).toBuffer()
    assert.ok(buffer.length <= 350*1024, `image ${brief.id} exceeds size budget`)
    fs.writeFileSync(path.join(out,file), buffer)
    const post = before.posts.find(p => p.id === brief.id)
    assert.ok(post); assert.ok(!/<img\b/i.test(post.content), `post ${post.id} already has interior images`)
    const headings = [...post.content.matchAll(/<h2\b/gi)]
    assert.ok(headings.length >= 2, `missing insertion chapter for ${post.id}`)
    const url = `/uploads/images/sg-article-illustrations-20261004/${file}`
    const html = `<p><img src="${url}" alt="${escape(brief.alt)}" width="1200" height="675" /></p><p><em>${escape(brief.caption)}（思路示意）</em></p>`
    const index = headings[1].index
    const content = post.content.slice(0,index) + html + post.content.slice(index)
    assert.equal(content.replace(html,''), post.content, 'original text changed')
    results.push({id:post.id,owner:post.user_id,gameId:post.game_id,title:post.title,cover:post.cover,publishedAt:post.published_at,expectedVersion:post.content_version,expectedContentSha256:sha(post.content),expectedMedia:post.media,expectedTags:post.tags,content,url,file,alt:brief.alt,caption:brief.caption,bytes:buffer.length,sha256:sha(buffer),width:1200,height:675,sourceSha256:sha(sourceBytes),...generated})
  }
  assert.equal(new Set(results.map(r=>r.sourceSha256)).size,results.length,'duplicate original images')
  assert.equal(new Set(results.map(r=>r.sha256)).size,results.length,'duplicate final images')
  fs.writeFileSync(path.join(artifacts,'generated-manifest.json'),JSON.stringify({preparedAt:new Date().toISOString(),count:results.length,images:results},null,2))
  fs.writeFileSync(path.join(__dirname,'prompt-set.json'),JSON.stringify(results.map(({id,title,prompt,revisionPrompt,tool})=>({id,title,prompt,revisionPrompt,tool})),null,2))
  for (let i=0;i<results.length;i+=6) {
    const batch=results.slice(i,i+6), tiles=[]
    for(let j=0;j<batch.length;j++) {
      const r=batch[j], thumb=await sharp(path.join(out,r.file)).resize(480,270).toBuffer()
      tiles.push({input:thumb,left:(j%3)*480,top:Math.floor(j/3)*302})
      const label=Buffer.from(`<svg width="480" height="32"><rect width="480" height="32" fill="#171717"/><text x="12" y="23" font-family="Arial" font-size="18" fill="white">Post ${r.id}</text></svg>`)
      tiles.push({input:label,left:(j%3)*480,top:Math.floor(j/3)*302+270})
    }
    await sharp({create:{width:1440,height:604,channels:3,background:'#171717'}}).composite(tiles).png().toFile(path.join(artifacts,`review-${String(Math.floor(i/6)+1).padStart(2,'0')}.png`))
  }
  if(results.length===36) {
    const posts=results.map(({id,owner,gameId,title,cover,publishedAt,expectedVersion,expectedContentSha256,expectedMedia,expectedTags,content,url,file,alt,caption,bytes,sha256,width,height})=>({id,owner,gameId,title,cover,publishedAt,expectedVersion,expectedContentSha256,expectedMedia,expectedTags,content,url,file,alt,caption,bytes,sha256,width,height}))
    const payload={batch:'article-illustrations-20261004-v1',posts}
    const bytes=Buffer.from(JSON.stringify(payload,null,2));fs.writeFileSync(path.join(__dirname,'payload.json'),bytes)
    fs.writeFileSync(path.join(artifacts,'payload.sha256'),sha(bytes)+'\n')
    console.log(JSON.stringify({complete:true,count:36,bytes:results.reduce((n,r)=>n+r.bytes,0),payloadSha256:sha(bytes),assetDirectory:out}))
  } else console.log(JSON.stringify({complete:false,count:results.length,assetDirectory:out}))
}
main().catch(e=>{console.error(e);process.exitCode=1})
