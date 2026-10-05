// Run inside sg-server. Add only one body illustration per existing published article.
// plan saves a private immutable backup; apply commits all content/media/reviews atomically.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const pool = require('/app/src/config/db')
const assets = require('/app/src/services/assetService')
const { decodeGuideInfo } = require('/app/src/utils/guideInfo')
const sharp = require('/app/node_modules/sharp')
sharp.concurrency(1)
const bytes = fs.readFileSync(path.join(__dirname,'payload.json'))
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const payload = JSON.parse(bytes)
const mode = process.argv[2], expectedHash = process.argv[3]
const eventKey = 'editorial:' + payload.batch
const backupFile = path.join(__dirname,'before.json'), receiptFile = path.join(__dirname,'receipt.json')
const imageRoot = '/app/uploads/images/sg-article-illustrations-20261004'
const ids = payload.posts.map(p=>p.id), marks = ids.map(()=>'?').join(',')
function fingerprint(current) {
  const keys=['id','user_id','title','content','cover','game_id','category','guide_info','content_version','status','published_at']
  return sha(JSON.stringify({posts:current.posts.map(p=>Object.fromEntries(keys.map(k=>[k,p[k]]))),media:current.media,postAssets:current.postAssets,postTags:current.postTags}))
}
async function state(db,lock=false) {
  const [posts]=await db.query(`SELECT * FROM posts WHERE id IN (${marks}) ORDER BY id${lock?' FOR UPDATE':''}`,ids)
  const [media]=await db.query(`SELECT * FROM media WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [postAssets]=await db.query(`SELECT * FROM post_assets WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [postTags]=await db.query(`SELECT pt.*,t.name FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE post_id IN (${marks}) ORDER BY pt.id`,ids)
  const [reviews]=await db.query(`SELECT * FROM post_reviews WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [uploadAssets]=await db.query(`SELECT a.* FROM upload_assets a WHERE EXISTS (SELECT 1 FROM post_assets pa WHERE pa.asset_id=a.id AND pa.post_id IN (${marks})) ORDER BY a.id`,ids)
  const [likes]=await db.query(`SELECT id,post_id FROM likes WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [favorites]=await db.query(`SELECT id,post_id FROM favorites WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [comments]=await db.query(`SELECT id,post_id FROM comments WHERE post_id IN (${marks}) ORDER BY id`,ids)
  return {posts,media,postAssets,postTags,reviews,uploadAssets,likes,favorites,comments}
}
async function validate(db,current) {
  assert.equal(sha(bytes),expectedHash,'payload checksum mismatch')
  assert.equal(payload.batch,'article-illustrations-20261004-v1')
  assert.equal(payload.posts.length,36);assert.equal(new Set(ids).size,36);assert.equal(current.posts.length,36)
  assert.equal(new Set(payload.posts.map(p=>p.sha256)).size,36,'duplicate final images')
  const [[actor]]=await db.query("SELECT id,username FROM users WHERE id=1 AND role='admin' AND status=1")
  assert.ok(actor,'enabled administrator required')
  for(const p of payload.posts) {
    const row=current.posts.find(r=>r.id===p.id)
    assert.equal(row.status,'published');assert.equal(row.user_id,p.owner);assert.equal(row.game_id,p.gameId)
    assert.equal(row.content_version,p.expectedVersion);assert.equal(row.title,p.title);assert.equal(row.cover,p.cover)
    assert.equal(new Date(row.published_at).toISOString(),p.publishedAt,'original publication time changed')
    assert.equal(sha(row.content),p.expectedContentSha256,'article edited since snapshot')
    const oldMedia=current.media.filter(m=>m.post_id===p.id).sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id).map(({id,url,type,sort_order})=>({id,url,type,sort_order}))
    assert.deepEqual(oldMedia,p.expectedMedia,'original media changed')
    assert.ok(!/<img\b/i.test(row.content));assert.equal((p.content.match(/<img\b/gi)||[]).length,1)
    assert.ok(p.content.includes(`src="${p.url}"`));assert.ok(p.content.includes('width="1200" height="675"'))
    const escapedUrl=p.url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
    const insertion=new RegExp(`<p><img src="${escapedUrl}"[^>]*\\/></p><p><em>[^<]+</em></p>`)
    assert.equal(p.content.replace(insertion,''),row.content,'original text was modified')
    assert.ok(!/<script|on\w+=|javascript:/i.test(p.content))
    assert.equal(p.url,`/uploads/images/sg-article-illustrations-20261004/post-${String(p.id).padStart(2,'0')}.webp`)
    assert.equal(p.file,path.basename(p.url));assert.ok(/^post-\d{2}\.webp$/.test(p.file))
    const image=fs.readFileSync(path.join(imageRoot,p.file));assert.equal(sha(image),p.sha256);assert.equal(image.length,p.bytes)
    const metadata=await sharp(image).metadata();assert.equal(metadata.width,1200);assert.equal(metadata.height,675);assert.equal(metadata.format,'webp');assert.ok(image.length<=350*1024)
    const [[exists]]=await db.query('SELECT COUNT(*) AS n FROM upload_assets WHERE url=?',[p.url]);assert.equal(Number(exists.n),0,'image URL already used')
  }
  return actor
}
async function approve(db,id,actor) {
  const [[row]]=await db.query('SELECT p.*,u.username,g.name AS game_name FROM posts p JOIN users u ON u.id=p.user_id JOIN games g ON g.id=p.game_id WHERE p.id=?',[id])
  assert.equal(row.status,'pending')
  const [tags]=await db.query('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=? ORDER BY t.id',[id])
  const [media]=await db.query('SELECT * FROM media WHERE post_id=? ORDER BY sort_order,id',[id])
  const snapshot={...row,guide_info:decodeGuideInfo(row.guide_info),tags:tags.map(t=>t.name),media}
  await db.execute("INSERT INTO post_reviews (post_id,content_version,reviewer_id,reviewer_username,decision,reason,snapshot) VALUES (?,?,?,?,'published',NULL,?)",[id,row.content_version,actor.id,actor.username,JSON.stringify(snapshot)])
  await db.execute("UPDATE posts SET status='published',published_at=COALESCE(published_at,NOW()),reject_reason=NULL WHERE id=?",[id])
}
async function verify(db,receipt) {
  assert.equal(receipt.payloadSha256,expectedHash)
  const current=await state(db), before=JSON.parse(fs.readFileSync(backupFile,'utf8'))
  const issues=[]
  for(const p of payload.posts) {
    const row=current.posts.find(r=>r.id===p.id), prior=before.posts.find(r=>r.id===p.id)
    if(row.content!==p.content||row.content_version!==p.expectedVersion+1||row.status!=='published')issues.push(`content/version/status:${p.id}`)
    for(const key of ['title','cover','game_id','user_id','category','published_at'])if(JSON.stringify(row[key])!==JSON.stringify(prior[key]))issues.push(`${key}:${p.id}`)
    if(JSON.stringify(row.guide_info)!==JSON.stringify(prior.guide_info))issues.push(`guide_info:${p.id}`)
    const images=current.media.filter(m=>m.post_id===p.id&&m.type==='image');if(images.length!==1||images[0].url!==p.url)issues.push(`image media:${p.id}`)
    const refs=current.postAssets.filter(a=>a.post_id===p.id&&a.usage_type==='content');if(refs.length!==1)issues.push(`asset refs:${p.id}`)
    const asset=current.uploadAssets.find(a=>a.url===p.url);if(!asset||asset.owner_id!==p.owner||asset.status!=='attached'||asset.expires_at!==null)issues.push(`asset state:${p.id}`)
    const review=current.reviews.find(r=>r.post_id===p.id&&r.content_version===row.content_version)
    const snapshot=typeof review?.snapshot==='string'?JSON.parse(review.snapshot):review?.snapshot
    if(review?.decision!=='published'||snapshot?.content!==p.content)issues.push(`review:${p.id}`)
  }
  // Existing media, references and tags retain their identities; users may add new interactions meanwhile.
  for(const table of ['media','postAssets','postTags'])for(const old of before[table])if(!current[table].some(r=>JSON.stringify(r)===JSON.stringify(old)))issues.push(`existing ${table}:${old.id}`)
  for(const table of ['likes','favorites','comments'])for(const old of before[table])if(!current[table].some(r=>r.id===old.id&&r.post_id===old.post_id))issues.push(`existing ${table}:${old.id}`)
  assert.deepEqual(issues,[])
  return {posts:36,bodyImages:current.media.filter(m=>m.type==='image').length,videos:current.media.filter(m=>m.type==='video').length,originalTextCoversPublicationPreserved:true,issues}
}
async function main() {
  assert.ok(['plan','apply','verify'].includes(mode));assert.equal(sha(bytes),expectedHash)
  const db=await pool.getConnection();let transaction=false,locked=false
  try {
    const [[lock]]=await db.execute('SELECT GET_LOCK(?,5) AS acquired',[eventKey]);assert.equal(lock.acquired,1);locked=true
    const [[previous]]=await db.execute('SELECT metadata FROM operation_logs WHERE event_key=?',[eventKey])
    if(previous) {
      const receipt=typeof previous.metadata==='string'?JSON.parse(previous.metadata):previous.metadata
      const result=await verify(db,receipt);fs.writeFileSync(receiptFile,JSON.stringify({...receipt,verification:result},null,2),{mode:0o600})
      console.log('ALREADY_APPLIED='+JSON.stringify({...receipt,verification:result}));return
    }
    assert.notEqual(mode,'verify','batch not applied')
    await db.beginTransaction();transaction=true
    const current=await state(db,mode==='apply'),actor=await validate(db,current)
    if(mode==='plan') {
      const snapshot={batch:payload.batch,payloadSha256:expectedHash,plannedAt:new Date().toISOString(),fingerprint:fingerprint(current),...current}
      fs.writeFileSync(backupFile,JSON.stringify(snapshot,null,2),{flag:'wx',mode:0o600})
      await db.rollback();transaction=false
      console.log('PLAN_OK='+JSON.stringify({posts:36,images:36,videosPreserved:current.media.filter(m=>m.type==='video').length,backup:backupFile,fingerprint:snapshot.fingerprint}));return
    }
    const before=JSON.parse(fs.readFileSync(backupFile,'utf8'));assert.equal(before.payloadSha256,expectedHash);assert.equal(before.fingerprint,fingerprint(current),'articles or media changed after plan')
    const added=[]
    for(const p of payload.posts) {
      const asset=await assets.registerUpload(p.owner,{url:p.url,type:'image'},db)
      assert.equal(asset.owner_id,p.owner)
      await db.execute('INSERT INTO post_assets (post_id,asset_id,usage_type,sort_order) VALUES (?,?,?,?)',[p.id,asset.id,'content',0])
      await db.execute("UPDATE upload_assets SET status='attached',expires_at=NULL WHERE id=?",[asset.id])
      const old=current.media.filter(m=>m.post_id===p.id),order=old.length?Math.max(...old.map(m=>m.sort_order))+1:0
      const [media]=await db.execute('INSERT INTO media (post_id,url,type,sort_order) VALUES (?,?,?,?)',[p.id,p.url,'image',order])
      const [updated]=await db.execute("UPDATE posts SET content=?,content_version=content_version+1,status='pending',submitted_at=NOW(),reject_reason=NULL WHERE id=? AND status='published' AND content_version=?",[p.content,p.id,p.expectedVersion]);assert.equal(updated.affectedRows,1)
      await approve(db,p.id,actor);added.push({postId:p.id,assetId:asset.id,mediaId:media.insertId,url:p.url,contentVersion:p.expectedVersion+1})
    }
    const receipt={batch:payload.batch,payloadSha256:expectedHash,appliedAt:new Date().toISOString(),updated:36,images:36,added}
    await db.execute('INSERT INTO operation_logs (admin_id,admin_username,action,method,path,target_type,detail,status,request_id,event_key,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[actor.id,actor.username,'article_illustrations','CLI','/ops/article-illustrations/20261004','content','按站点所有者要求，为现有 36 篇攻略分别加入 1 张独立生成的相关正文插图；保留原文、封面、视频、作者、游戏、发布时间与互动；同步资产登记和审核快照。',200,payload.batch,eventKey,JSON.stringify(receipt)])
    await db.commit();transaction=false
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600})
    console.log('ILLUSTRATIONS_PUBLISH_OK='+JSON.stringify(receipt))
    console.log('VERIFY_OK='+JSON.stringify(await verify(db,receipt)))
  } catch(e) {if(transaction)await db.rollback();throw e}
  finally {if(locked)await db.execute('SELECT RELEASE_LOCK(?)',[eventKey]);db.release()}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>pool.end())
