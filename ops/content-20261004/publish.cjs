// Run inside the existing sg-server container. plan is read-only except private backup output.
// apply uses one transaction for categories, edits, assets, reviews and the idempotency journal.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const pool = require('/app/src/config/db')
const assets = require('/app/src/services/assetService')
const { normalizeGuideInfo, CATEGORIES, decodeGuideInfo } = require('/app/src/utils/guideInfo')
const sharp = require('/app/node_modules/sharp')
const bytes = fs.readFileSync(path.join(__dirname,'payload.json'))
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const payload = JSON.parse(bytes)
const mode = process.argv[2]
const expectedHash = process.argv[3]
const eventKey = 'editorial:' + payload.batch
const backupFile = path.join(__dirname,'before.json')
const receiptFile = path.join(__dirname,'receipt.json')
const coverRoot = '/app/uploads/images/sg-library-20261004'
const gameDescriptions = [
  'FromSoftware 的开放世界动作 RPG，涵盖交界地探索、Boss 战与多种配装。',
  'FromSoftware 的战国忍者动作游戏，主打弹开、躯干攻防与忍义手。',
  '黑暗之魂系列第三部，围绕传火、近战窗口、装备选择与场景探索展开。',
  '黑暗之魂系列初代；本区覆盖原版与重制版，关注互联地图与传火旅程。',
  '魂系列源头；本区以 PS5 重制版攻略为主，涉及灵魂形态与世界倾向。',
  'FromSoftware 的哥特猎杀动作 RPG，主打变形武器、夺回与主动进攻。',
  'Team NINJA 的暗黑战国动作 RPG，围绕残心、武技、妖怪能力与装备成长展开。'
]
function fingerprint(state) {
  return sha(JSON.stringify({games:state.games,posts:state.posts.map(p=>Object.fromEntries(['id','user_id','title','content','cover','game_id','category','guide_info','content_version','status','published_at'].map(k=>[k,p[k]])))}))
}
async function state(db, lock=false) {
  const [games] = await db.query('SELECT id,name,description,cover,status,sort_order,version FROM games ORDER BY id' + (lock?' FOR UPDATE':''))
  const ids = payload.existing.map(p=>p.id)
  const marks = ids.map(()=>'?').join(',')
  const [posts] = await db.query(`SELECT * FROM posts WHERE id IN (${marks}) ORDER BY id${lock?' FOR UPDATE':''}`,ids)
  const [media] = await db.query(`SELECT * FROM media WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [postTags] = await db.query(`SELECT pt.*,t.name FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE post_id IN (${marks}) ORDER BY pt.id`,ids)
  const [postAssets] = await db.query(`SELECT * FROM post_assets WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [likes] = await db.query(`SELECT id,post_id FROM likes WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [favorites] = await db.query(`SELECT id,post_id FROM favorites WHERE post_id IN (${marks}) ORDER BY id`,ids)
  const [comments] = await db.query(`SELECT id,post_id FROM comments WHERE post_id IN (${marks}) ORDER BY id`,ids)
  return {games,posts,media,postTags,postAssets,likes,favorites,comments}
}
async function validate(db, current) {
  assert.equal(sha(bytes),expectedHash,'payload checksum mismatch')
  assert.equal(payload.batch,'library-20261004-v1')
  assert.equal(payload.games.length,12)
  assert.equal(payload.posts.length,24)
  assert.equal(current.posts.length,12)
  assert.equal(current.games.length,7,'category list changed; refresh plan first')
  const [authors] = await db.query('SELECT id,username,role,status FROM users WHERE id BETWEEN 3 AND 9 ORDER BY id FOR UPDATE')
  assert.equal(authors.length,7)
  for(const u of authors) {
    assert.equal(u.username,`sg_demo_20260914_${String(u.id-2).padStart(2,'0')}`,'not an editorial account')
    assert.equal(u.role,'creator'); assert.equal(u.status,1)
  }
  for(const post of payload.existing) {
    const row = current.posts.find(r=>r.id===post.id)
    assert.equal(row.user_id,post.owner);assert.equal(row.game_id,post.gameId);assert.equal(row.status,'published')
  }
  const [[admin]] = await db.query("SELECT id,username FROM users WHERE id=1 AND role='admin' AND status=1")
  assert.ok(admin,'expected enabled administrator missing')
  for(const game of payload.games) {
    assert.ok(!current.games.some(g=>g.name===game.name),'new category already exists')
    assert.equal(payload.posts.filter(p=>p.game===game.key).length,2)
  }
  for(const post of [...payload.existing,...payload.posts]) {
    assert.ok(post.content.replace(/<[^>]+>/g,'').length>=400)
    assert.ok(post.title.length<=200)
    assert.ok(!/<script|on\w+=|javascript:/i.test(post.content))
    normalizeGuideInfo(post.guide_info)
    if(post.category)assert.ok(CATEGORIES.includes(post.category))
  }
  for(const asset of payload.assets) {
    assert.ok(/^[a-z0-9]+-0[12]\.webp$/.test(asset.file))
    const data = fs.readFileSync(path.join(coverRoot,asset.file))
    assert.equal(sha(data),asset.sha256)
    const info = await sharp(data).metadata()
    assert.equal(info.width,1200);assert.equal(info.height,675);assert.ok(data.length<=350*1024)
  }
  return admin
}
async function tags(db, id, names) {
  for(const name of [...new Set(names)].sort()) {
    const [r]=await db.execute('INSERT INTO tags (name) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[name])
    await db.execute('INSERT IGNORE INTO post_tags (post_id,tag_id) VALUES (?,?)',[id,r.insertId])
  }
}
async function approve(db,id,actor) {
  const [[row]]=await db.execute('SELECT p.*,u.username,g.name AS game_name FROM posts p JOIN users u ON u.id=p.user_id JOIN games g ON g.id=p.game_id WHERE p.id=?',[id])
  assert.equal(row.status,'pending')
  const [t]=await db.execute('SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=? ORDER BY t.id',[id])
  const [m]=await db.execute('SELECT * FROM media WHERE post_id=? ORDER BY sort_order,id',[id])
  const snapshot={...row,guide_info:decodeGuideInfo(row.guide_info),tags:t.map(x=>x.name),media:m}
  await db.execute("INSERT INTO post_reviews (post_id,content_version,reviewer_id,reviewer_username,decision,reason,snapshot) VALUES (?,?,?,?,'published',NULL,?)",[id,row.content_version,actor.id,actor.username,JSON.stringify(snapshot)])
  await db.execute("UPDATE posts SET status='published',published_at=COALESCE(published_at,NOW()),reject_reason=NULL WHERE id=?",[id])
}
async function main() {
  assert.ok(['plan','apply','verify'].includes(mode),'mode must be plan/apply/verify')
  const db=await pool.getConnection()
  let transaction=false, acquired=false
  try {
    const [[lock]]=await db.execute('SELECT GET_LOCK(?,5) AS acquired',[eventKey]);assert.equal(lock.acquired,1);acquired=true
    const [[previous]]=await db.execute('SELECT metadata FROM operation_logs WHERE event_key=?',[eventKey])
    if(previous) {
      const receipt=typeof previous.metadata==='string'?JSON.parse(previous.metadata):previous.metadata
      assert.equal(receipt.payloadSha256,expectedHash,'batch already used for different content')
      fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600})
      console.log('ALREADY_APPLIED='+JSON.stringify(receipt))
      return
    }
    assert.notEqual(mode,'verify','batch not applied')
    await db.beginTransaction();transaction=true
    const current=await state(db,mode==='apply')
    const actor=await validate(db,current)
    if(mode==='plan') {
      const snapshot={batch:payload.batch,payloadSha256:sha(bytes),plannedAt:new Date().toISOString(),fingerprint:fingerprint(current),...current}
      fs.writeFileSync(backupFile,JSON.stringify(snapshot,null,2),{flag:'wx',mode:0o600})
      await db.rollback();transaction=false
      console.log('PLAN_OK='+JSON.stringify({games:current.games.length,oldPosts:current.posts.length,newGames:12,newPosts:24,backup:backupFile,fingerprint:snapshot.fingerprint}))
      return
    }
    const before=JSON.parse(fs.readFileSync(backupFile,'utf8'))
    assert.equal(before.payloadSha256,expectedHash)
    assert.equal(fingerprint(current),before.fingerprint,'content or categories changed after plan')
    const gameIds={};let order=Math.max(...current.games.map(g=>g.sort_order))
    for(let i=0;i<gameDescriptions.length;i++)await db.execute('UPDATE games SET description=?,version=version+1 WHERE id=?',[gameDescriptions[i],i+1])
    for(const game of payload.games) {
      const cover=payload.posts.find(p=>p.game===game.key).cover
      const [r]=await db.execute('INSERT INTO games (name,description,cover,sort_order,status) VALUES (?,?,?,?,1)',[game.name,game.description,cover,++order])
      gameIds[game.key]=r.insertId
    }
    const updated=[]
    for(const post of payload.existing) {
      await db.execute("UPDATE posts SET title=?,content=?,guide_info=?,content_version=content_version+1,status='pending',submitted_at=NOW(),reject_reason=NULL WHERE id=?",[post.title,post.content,JSON.stringify(post.guide_info),post.id])
      await tags(db,post.id,post.tags);await approve(db,post.id,actor);updated.push(post.id)
    }
    const created=[]
    const ordered=[...payload.posts].sort((a,b)=>a.key.slice(-2).localeCompare(b.key.slice(-2)) || payload.games.findIndex(g=>g.key===a.game)-payload.games.findIndex(g=>g.key===b.game))
    for(const post of ordered) {
      const owner=payload.games.find(g=>g.key===post.game).owner
      await assets.registerUpload(owner,{url:post.cover,type:'image'},db)
      const [r]=await db.execute("INSERT INTO posts (title,content,cover,game_id,category,user_id,guide_info,status,submitted_at) VALUES (?,?,?,?,?,?,?,'pending',NOW())",[post.title,post.content,post.cover,gameIds[post.game],post.category,owner,JSON.stringify(post.guide_info)])
      await tags(db,r.insertId,post.tags)
      await assets.replacePostAssets(r.insertId,owner,[{url:post.cover,usage_type:'cover',sort_order:0}],db)
      await approve(db,r.insertId,actor)
      created.push({key:post.key,id:r.insertId,game_id:gameIds[post.game],cover:post.cover})
    }
    const receipt={batch:payload.batch,payloadSha256:sha(bytes),appliedAt:new Date().toISOString(),gameIds,updated,created,covers:24}
    await db.execute('INSERT INTO operation_logs (admin_id,admin_username,action,method,path,target_type,detail,status,request_id,event_key,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[actor.id,actor.username,'content_library','CLI','/ops/content-library/20261004','content', '按站点所有者要求扩充 12 个游戏、改写 12 篇攻略、发布 24 篇带独立 AI 封面的攻略；保留旧互动与视频；不生成虚假互动。',200,payload.batch,eventKey,JSON.stringify(receipt)])
    await db.commit();transaction=false
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600})
    console.log('CONTENT_PUBLISH_OK='+JSON.stringify(receipt))
  } catch(e) { if(transaction)await db.rollback();throw e }
  finally { if(acquired)await db.execute('SELECT RELEASE_LOCK(?)',[eventKey]);db.release() }
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end())
