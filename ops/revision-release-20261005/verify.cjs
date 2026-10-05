// Read-only acceptance: short-lived diagnostic tokens never leave this process.
const fs = require('fs')
const crypto = require('crypto')
const pool = require('/app/src/config/db')
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function main() {
  const [posts] = await pool.execute('SELECT id,user_id,title,content,cover,game_id,category,guide_info,published_at,status FROM posts ORDER BY id')
  const [media] = await pool.execute('SELECT post_id,url,type,sort_order FROM media ORDER BY post_id,type,sort_order,url')
  const [tags] = await pool.execute('SELECT pt.post_id,t.name FROM post_tags pt JOIN tags t ON t.id=pt.tag_id ORDER BY pt.post_id,t.name')
  const [users] = await pool.execute('SELECT id,username,nickname,avatar,role,status,token_version FROM users ORDER BY id')
  const [[games]] = await pool.execute('SELECT COUNT(*) AS n FROM games')
  const result = { posts: posts.length, games: games.n, users: users.length, media: media.length, contentHash: hash({ posts,media,tags }), accountHash: hash(users) }
  if (process.argv[2] === 'before') {
    fs.writeFileSync('/app/logs/post-revisions-20261005-before.json', JSON.stringify(result), { mode: 0o600 })
  } else {
    const before = JSON.parse(fs.readFileSync('/app/logs/post-revisions-20261005-before.json'))
    if (result.contentHash !== before.contentHash || result.accountHash !== before.accountHash) throw Error('Unexpected existing content/account changes')
    const [[migration]] = await pool.execute("SELECT COUNT(*) AS n FROM schema_migrations WHERE version='016_post_revisions'")
    if (migration.n !== 1) throw Error('Missing migration')
    const [[admin]] = await pool.execute("SELECT id,username,role,token_version FROM users WHERE role='admin' AND status=1 LIMIT 1")
    const jwt = require('/app/node_modules/jsonwebtoken')
    const token = jwt.sign({ id: admin.id,username: admin.username,role: admin.role,ver: admin.token_version }, process.env.JWT_SECRET, { expiresIn: '2m' })
    const paths = ['/games','/posts?pageSize=15','/admin/posts/pending','/admin/stats','/notifications/summary','/posts/my/list']
    for (const route of paths) {
      const r = await fetch('http://127.0.0.1:3000/api' + route, { headers: { Authorization: 'Bearer ' + token } })
      if (r.status !== 200) throw Error(`Unexpected status ${r.status}: ${route}`)
    }
    for (const post of posts) {
      if (post.status !== 'published') continue
      const r = await fetch('http://127.0.0.1:3000/api/posts/' + post.id)
      if (r.status !== 200) throw Error('Post unavailable: ' + post.id)
      const detail = (await r.json()).data
      if (detail.content !== post.content || detail.is_revision) throw Error('Public detail mismatch: ' + post.id)
    }
    result.acceptance = 'POST_REVISIONS_ACCEPTANCE_OK'
  }
  console.log(JSON.stringify(result))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 }).finally(() => pool.end())
