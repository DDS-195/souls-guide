// Read-only acceptance against the committed content batch and private before snapshot.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const pool = require('/app/src/config/db')
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8'))
const payload = read('payload.json'), before = read('before.json'), receipt = read('receipt.json')
const decode = value => typeof value === 'string' ? JSON.parse(value) : value
const date = value => value == null ? null : new Date(value).toISOString()
const serial = value => JSON.parse(JSON.stringify(value))
async function main() {
  const [games] = await pool.query('SELECT * FROM games ORDER BY id')
  const [posts] = await pool.query('SELECT * FROM posts ORDER BY id')
  assert.equal(games.length,19); assert.equal(posts.length,36)
  assert.ok(posts.every(p=>p.status==='published'))
  const [media] = await pool.query('SELECT * FROM media ORDER BY id')
  for (const old of before.media) assert.deepEqual(serial(media.find(m=>m.id===old.id)),old)
  for (const table of ['likes','favorites','comments']) {
    const [rows] = await pool.query(`SELECT id,post_id FROM ${table} ORDER BY id`)
    for (const old of before[table]) assert.deepEqual(rows.find(r=>r.id===old.id),old,`${table} relationship removed`)
  }
  const [oldAssets] = await pool.query('SELECT * FROM post_assets WHERE post_id<=12 ORDER BY id')
  assert.deepEqual(serial(oldAssets),before.postAssets)
  const [postTags] = await pool.query('SELECT pt.*,t.name FROM post_tags pt JOIN tags t ON t.id=pt.tag_id ORDER BY pt.id')
  for (const old of before.postTags) assert.deepEqual(serial(postTags.find(r=>r.id===old.id)),old)
  const [reviews] = await pool.query('SELECT post_id,content_version,decision,snapshot FROM post_reviews ORDER BY id')
  for (const draft of payload.existing) {
    const post = posts.find(p=>p.id===draft.id), old = before.posts.find(p=>p.id===draft.id)
    assert.equal(post.title,draft.title); assert.equal(post.content,draft.content)
    assert.deepEqual(decode(post.guide_info),draft.guide_info)
    for (const key of ['user_id','game_id','category','cover']) assert.equal(post[key],old[key])
    assert.equal(date(post.published_at),date(old.published_at))
    assert.equal(post.content_version,old.content_version+1)
    // Live traffic may increase counters; compare each counter to its actual relationship count.
    assert.ok(post.view_count>=old.view_count,'view count reset')
    const review=reviews.find(r=>r.post_id===post.id && r.content_version===post.content_version)
    assert.equal(review?.decision,'published'); assert.equal(decode(review.snapshot).content,post.content)
  }
  const [attached] = await pool.query("SELECT pa.post_id,pa.usage_type,a.owner_id,a.url,a.status,a.expires_at FROM post_assets pa JOIN upload_assets a ON a.id=pa.asset_id WHERE pa.post_id>12 ORDER BY pa.post_id")
  for (const entry of receipt.created) {
    const draft=payload.posts.find(p=>p.key===entry.key), game=payload.games.find(g=>g.key===draft.game)
    const post=posts.find(p=>p.id===entry.id), image=attached.find(a=>a.post_id===entry.id && a.usage_type==='cover')
    assert.equal(post.title,draft.title); assert.equal(post.content,draft.content)
    assert.equal(post.cover,draft.cover); assert.equal(post.user_id,game.owner)
    assert.equal(post.game_id,receipt.gameIds[game.key]); assert.equal(post.category,draft.category)
    assert.deepEqual(decode(post.guide_info),draft.guide_info)
    assert.equal(post.content_version,1); assert.equal(image?.status,'attached')
    assert.equal(image.url,post.cover); assert.equal(image.owner_id,post.user_id); assert.equal(image.expires_at,null)
    const review=reviews.find(r=>r.post_id===post.id && r.content_version===1)
    assert.equal(review?.decision,'published'); assert.equal(decode(review.snapshot).cover,post.cover)
    const actualTags=postTags.filter(t=>t.post_id===post.id).map(t=>t.name)
    for(const tag of draft.tags) assert.ok(actualTags.includes(tag))
  }
  for (const draft of payload.games) {
    const game=games.find(g=>g.id===receipt.gameIds[draft.key])
    assert.equal(game.name,draft.name); assert.equal(game.description,draft.description); assert.equal(game.status,1)
    assert.equal(posts.filter(p=>p.game_id===game.id).length,2)
  }
  for (const old of before.games) {
    const game=games.find(g=>g.id===old.id)
    for(const key of ['name','cover','sort_order','status']) assert.equal(game[key],old[key])
    assert.equal(game.version,old.version+1)
  }
  const [counters] = await pool.query(`SELECT p.id,p.like_count,p.comment_count,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS actual_likes,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS actual_comments FROM posts p`)
  for (const p of counters) {
    assert.equal(p.like_count,p.actual_likes,`likes mismatch ${p.id}`)
    assert.equal(p.comment_count,p.actual_comments,`comments mismatch ${p.id}`)
  }
  const [[journal]]=await pool.execute('SELECT metadata FROM operation_logs WHERE event_key=?',['editorial:'+payload.batch])
  assert.deepEqual(decode(journal.metadata),receipt)
  const result={checkedAt:new Date().toISOString(),games:games.length,publishedPosts:posts.length,
    rewrittenPosts:12,createdPosts:24,attachedCovers:attached.length,preservedMedia:before.media.length,
    preservedLikes:before.likes.length,preservedFavorites:before.favorites.length,preservedComments:before.comments.length,
    reviewedVersions:36,allNewGamesHaveTwoPosts:true,countersConsistent:true}
  fs.writeFileSync(path.join(__dirname,'verification-db.json'),JSON.stringify(result,null,2),{mode:0o600})
  console.log('DB_ACCEPTANCE_OK='+JSON.stringify(result))
}
main().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>pool.end())
