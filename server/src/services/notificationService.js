const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')
const types = ['like','comment','reply','follow','audit','system']
const fail = (message, statusCode=400) => { throw Object.assign(new Error(message), { statusCode }) }
function positive(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1) fail('通知编号无效')
  return Number(value)
}
// 调用方持有文章/目标用户行锁；同一互动在十分钟内只提醒一次，不抑制评论正文。
async function emit(db, receiver, sender, type, targetType, targetId, content, commentId=null) {
  if (type === 'like' || type === 'follow') {
    const [[recent]] = await db.execute("SELECT id FROM notifications WHERE receiver_id=? AND sender_id=? AND type=? AND target_id=? AND created_at>DATE_SUB(NOW(),INTERVAL 10 MINUTE) LIMIT 1", [receiver,sender,type,targetId])
    if (recent) return
  }
  let title = null
  if (targetType === 'post') {
    const [[post]] = await db.execute('SELECT title FROM posts WHERE id=?', [targetId])
    title = post?.title || null
  }
  await db.execute('INSERT INTO notifications (receiver_id,sender_id,type,target_type,target_id,content,context_title,comment_id) VALUES (?,?,?,?,?,?,?,?)',
    [receiver,sender,type,targetType,targetId,content,title,commentId])
}
async function summary(userId, db=pool) {
  const [[row]] = await db.execute('SELECT COUNT(*) AS unread,COALESCE(MAX(id),0) AS cutoff_id FROM notifications WHERE receiver_id=? AND is_read=0', [userId])
  return row
}
async function list(userId, {page=1,pageSize=20,unreadOnly=false,type}) {
  if (type && !types.includes(type)) fail('通知类型无效')
  return withTransaction(async db => {
    const where = 'n.receiver_id=?'+(unreadOnly?' AND n.is_read=0':'')+(type?' AND n.type=?':'')
    const params = type?[userId,type]:[userId]
    const [rows] = await db.execute(`SELECT n.*,u.username,u.nickname,u.avatar,
      COALESCE(n.context_title,p.title) AS context_title,
      CASE WHEN n.target_type='post' THEN p.id IS NOT NULL AND p.status='published'
           WHEN n.target_type='user' THEN target.id IS NOT NULL
           WHEN n.target_type='creatorship' THEN 1 ELSE 0 END AS target_available
      FROM notifications n LEFT JOIN users u ON u.id=n.sender_id
      LEFT JOIN posts p ON n.target_type='post' AND p.id=n.target_id
      LEFT JOIN users target ON n.target_type='user' AND target.id=n.target_id
      WHERE ${where} ORDER BY n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`, [...params,String(pageSize),String((page-1)*pageSize)])
    const [[{total}]] = await db.execute(`SELECT COUNT(*) AS total FROM notifications n WHERE ${where}`, params)
    return {list:rows,total,page,pageSize,...await summary(userId,db)}
  })
}
async function mark(userId,id,cutoff,type) {
  if (type && !types.includes(type)) fail('通知类型无效')
  if (id != null) await pool.execute('UPDATE notifications SET is_read=1 WHERE receiver_id=? AND id=? AND is_read=0',[userId,positive(id)])
  else {
    // 兼容旧客户端；新客户端必须提交其查询响应的截止编号。
    const bound = cutoff == null ? (await summary(userId)).cutoff_id : Number(cutoff)
    if (!/^\d+$/.test(String(cutoff == null ? bound : cutoff)) || !Number.isSafeInteger(bound) || bound<0) fail('截止编号无效')
    await pool.execute('UPDATE notifications SET is_read=1 WHERE receiver_id=? AND id<=? AND is_read=0'+(type?' AND type=?':''), type?[userId,bound,type]:[userId,bound])
  }
  return summary(userId)
}
async function target(userId,id) {
  const [[n]] = await pool.execute('SELECT * FROM notifications WHERE receiver_id=? AND id=?',[userId,positive(id)])
  if (!n) fail('通知不存在',404)
  if (n.target_type==='creatorship') return {path:'/me/profile'}
  if (n.target_type==='user') {
    const [[u]]=await pool.execute('SELECT id FROM users WHERE id=?',[n.target_id])
    return {path:u?`/user/${u.id}`:null,message:u?null:'相关用户已注销'}
  }
  if (n.target_type==='post') {
    const [[p]]=await pool.execute("SELECT id FROM posts WHERE id=? AND status='published'",[n.target_id])
    if (!p) return {path:null,message:'相关文章已删除或暂不可访问'}
    let path=`/post/${p.id}`, message=null
    if (n.comment_id) {
      const [[c]]=await pool.execute('SELECT id FROM comments WHERE id=? AND post_id=? AND is_deleted=0',[n.comment_id,p.id])
      if (c) {
        const [parents]=await pool.execute(`WITH RECURSIVE ancestors AS (
          SELECT id,parent_id,created_at FROM comments WHERE id=?
          UNION ALL SELECT c.id,c.parent_id,c.created_at FROM comments c JOIN ancestors a ON c.id=a.parent_id
        ) SELECT id,created_at FROM ancestors WHERE parent_id IS NULL`,[c.id])
        if (parents[0]) {
          const root=parents[0]
          const [[{position}]]=await pool.execute('SELECT COUNT(*) AS position FROM comments WHERE post_id=? AND parent_id IS NULL AND (created_at>? OR (created_at=? AND id>?))',[p.id,root.created_at,root.created_at,root.id])
          path+=`?comment_page=${Math.floor(position/20)+1}&comment_id=${c.id}#comment-${c.id}`
        }
      } else message='该评论已删除，仍可查看文章'
    }
    return {path,message}
  }
  return {path:null,message:'此通知没有关联页面'}
}
module.exports={emit,summary,list,mark,target}
