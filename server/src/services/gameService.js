const pool = require('../config/db')
const withTransaction = require('../utils/withTransaction')
const assetService = require('./assetService')
async function transaction(work) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await withTransaction(work) }
    catch (error) {
      if (error.code !== 'ER_LOCK_DEADLOCK') throw error
      if (attempt === 2) fail('游戏正在被其他操作修改，请刷新重试')
    }
  }
}
function fail(message, statusCode = 409) {
  throw Object.assign(new Error(message), { statusCode, code: statusCode })
}
async function findAll(includeInactive = false) {
  const [rows] = await pool.execute(`SELECT * FROM games ${includeInactive ? '' : 'WHERE status=1'} ORDER BY sort_order,id`)
  return rows
}
async function findAllAdmin() {
  const [rows] = await pool.execute(`SELECT g.*, (SELECT COUNT(*) FROM posts p WHERE p.game_id=g.id) AS post_count
    FROM games g ORDER BY g.sort_order,g.id`)
  return rows
}
async function findById(id) {
  const [[row]] = await pool.execute('SELECT id,name,status FROM games WHERE id=?',[id])
  return row || null
}
async function create({name,description,cover,sort_order}) {
  return transaction(async db => {
    const [rows] = await db.execute('SELECT id,sort_order FROM games ORDER BY id FOR UPDATE')
    const order = sort_order ?? Math.min(2147483647, Math.max(0,...rows.map(g=>g.sort_order))+1)
    const [result] = await db.execute('INSERT INTO games (name,description,cover,sort_order) VALUES (?,?,?,?)',[name,description || '',cover || null,order])
    await require('../utils/auditContext').record(db, { id: result.insertId, name })
    return result.insertId
  })
}
async function queueCover(db, url) {
  if (!assetService.isLocalUploadUrl(url)) return
  await assetService.markUrlsUnreferenced([url],db)
  await db.execute('INSERT IGNORE INTO game_cover_cleanup (url) VALUES (?)',[url])
}
async function update(id, fields) {
  return transaction(async db => {
    const [[current]] = await db.execute('SELECT * FROM games WHERE id=? FOR UPDATE',[id])
    if (!current) return 0
    if (current.version !== fields.version) fail('游戏已被修改，请刷新后重试')
    const sets = ['version=version+1'], values = []
    for (const key of ['name','description','cover','sort_order','status']) {
      if (fields[key] !== undefined) { sets.push(`${key}=?`); values.push(fields[key]) }
    }
    await db.execute(`UPDATE games SET ${sets.join(',')} WHERE id=?`,[...values,id])
    if (fields.cover !== undefined && fields.cover !== current.cover) await queueCover(db,current.cover)
    await require('../utils/auditContext').record(db, { version: current.version + 1, status: fields.status ?? current.status })
    return 1
  })
}
async function remove(id, version) {
  return transaction(async db => {
    const [[game]] = await db.execute('SELECT * FROM games WHERE id=? FOR UPDATE',[id])
    if (!game) return 0
    if (game.version !== version) fail('游戏已被修改，请刷新后重试')
    const [[{ count }]] = await db.execute('SELECT COUNT(*) AS count FROM posts WHERE game_id=?',[id])
    if (count) fail('该游戏下已有文章，不可删除',400)
    await db.execute('DELETE FROM games WHERE id=?',[id])
    await queueCover(db,game.cover)
    await require('../utils/auditContext').record(db, { name: game.name, version })
    return 1
  })
}
async function sort(items) {
  return transaction(async db => {
    const ids = [...new Set(items.map(x=>x.id))].sort((a,b)=>a-b)
    if (ids.length !== items.length) return false
    const [rows] = await db.execute(`SELECT id,version FROM games WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`,ids)
    if (rows.length !== ids.length) return false
    const versions = new Map(rows.map(g=>[g.id,g.version]))
    if (items.some(g=>versions.get(g.id)!==g.version)) fail('排序或游戏信息已变化，请刷新后重试')
    for (const g of items) await db.execute('UPDATE games SET sort_order=?,version=version+1 WHERE id=?',[g.sort_order,g.id])
    await require('../utils/auditContext').record(db, { order: items.map(g => ({ id: g.id, sort_order: g.sort_order })) })
    return true
  })
}
// 在文章事务内共享锁定游戏；已有文章可以保留停用游戏的原归属。
async function assertAssignable(db, id, originalId = null) {
  const [[game]] = await db.execute('SELECT status FROM games WHERE id=? LOCK IN SHARE MODE',[id])
  if (!game) fail('游戏不存在',400)
  if (game.status !== 1 && Number(id) !== Number(originalId)) fail('游戏已停用，不能新增文章归属',400)
}
module.exports = { findAll,findAllAdmin,findById,create,update,remove,sort,assertAssignable }
