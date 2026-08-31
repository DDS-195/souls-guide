const pool = require('../config/db')
const fs = require('fs')
const path = require('path')

const SERVER_ROOT = path.join(__dirname, '..', '..')
const UPLOADS_DIR = path.join(SERVER_ROOT, 'uploads')

// 查媒体 + 所属文章作者（供本人/admin 校验）；不存在返回 null
async function findMedia(id) {
  const [rows] = await pool.execute(
    'SELECT m.id, m.url, m.post_id, p.user_id AS author_id FROM media m JOIN posts p ON m.post_id = p.id WHERE m.id = ?',
    [id]
  )
  return rows[0] || null
}

// 2026-08-13（P2-5）：删除 /uploads/ 下的磁盘文件。
// 安全：URL 必须 /uploads/ 开头且解析后仍在 uploads 目录内（防路径穿越）；文件不存在/非 uploads 路径忽略
async function unlinkUploads(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return
  const abs = path.resolve(SERVER_ROOT, url.replace(/^\/+/, ''))
  if (!abs.startsWith(UPLOADS_DIR + path.sep)) return
  try { await fs.promises.unlink(abs) } catch (e) { /* 文件已被删除/不存在，忽略 */ }
}

// 删除媒体：磁盘文件 + media 行（磁盘清理逻辑统一走 unlinkUploads）
async function removeMedia(id, url) {
  await unlinkUploads(url)
  await pool.execute('DELETE FROM media WHERE id = ?', [id])
}

module.exports = { findMedia, removeMedia, unlinkUploads }
