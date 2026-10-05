const pool = require('/app/src/config/db')
async function main() {
  const [users] = await pool.query('SELECT id,username,nickname,avatar,role,status,created_at FROM users ORDER BY id')
  const [counts] = await pool.query('SELECT user_id,COUNT(*) AS posts FROM posts GROUP BY user_id ORDER BY user_id')
  console.log(JSON.stringify({users,postCounts:counts},null,2))
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end())
