const pool = require('../config/db')
const mediaService = require('./mediaService')

// 公开列表（前端 Tab 用，仅启用）
async function findAll() {
  const [rows] = await pool.execute('SELECT * FROM games WHERE status = 1 ORDER BY sort_order ASC')
  return rows
}

// 管理端列表（含停用）
async function findAllAdmin() {
  const [rows] = await pool.execute('SELECT * FROM games ORDER BY sort_order ASC')
  return rows
}

// 按 id 查游戏（2026-08-13 新增：文章创建/编辑校验 game_id 存在性用）
async function findById(id) {
  const [rows] = await pool.execute('SELECT id, name, status FROM games WHERE id=?', [id])
  return rows[0] || null
}

async function create({ name, description, cover, sort_order }) {
  const [result] = await pool.execute('INSERT INTO games (name, description, cover, sort_order) VALUES (?, ?, ?, ?)', [
    name, description || '', cover || null, sort_order || 0,
  ])
  return result.insertId
}

// 2026-08-13 修复：改为部分更新——status 不传时保持原值（旧实现 status===undefined→1，
// 编辑游戏信息会把已停用的游戏重新启用）；其余字段同样只更新传入项
async function update(id, { name, description, cover, sort_order, status }) {
  const sets = []
  const params = []
  if (name !== undefined) { sets.push('name=?'); params.push(name) }
  if (description !== undefined) { sets.push('description=?'); params.push(description || '') }
  if (cover !== undefined) { sets.push('cover=?'); params.push(cover || null) }
  if (sort_order !== undefined) { sets.push('sort_order=?'); params.push(sort_order) }
  if (status !== undefined) { sets.push('status=?'); params.push(status) }
  if (!sets.length) return 0
  params.push(id)
  const [result] = await pool.execute(`UPDATE games SET ${sets.join(', ')} WHERE id=?`, params)
  return result.affectedRows
}

// 2026-08-13：删除游戏同时清理封面磁盘文件（行删除后 unlink，防孤儿文件残留）
async function remove(id) {
  const [[game]] = await pool.execute('SELECT cover FROM games WHERE id=?', [id])
  const [result] = await pool.execute('DELETE FROM games WHERE id=?', [id])
  if (result.affectedRows && game) await mediaService.unlinkUploads(game.cover)
  return result.affectedRows
}

// 批量排序 body: [{id, sort_order}]
async function sort(items) {
  for (const { id, sort_order } of items) {
    await pool.execute('UPDATE games SET sort_order=? WHERE id=?', [sort_order, id])
  }
}

module.exports = { findAll, findAllAdmin, findById, create, update, remove, sort }
