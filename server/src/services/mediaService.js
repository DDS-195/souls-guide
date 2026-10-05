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
  // 任何业务引用或尚未过期的资产登记存在时都不得删除物理文件。
  // 这使旧调用方也具备共享 URL 保护，而不依赖调用者自己判断所有权。
  const [[{ refs }]] = await pool.execute(
    `SELECT
      (SELECT COUNT(*) FROM upload_assets WHERE url=? AND status<>'deleted') +
      (SELECT COUNT(*) FROM media WHERE url=?) +
      (SELECT COUNT(*) FROM posts WHERE cover=?) +
      (SELECT COUNT(*) FROM users WHERE avatar=?) +
      (SELECT COUNT(*) FROM games WHERE cover=?) AS refs`,
    [url, url, url, url, url]
  )
  if (Number(refs) > 0) return false
  try { await fs.promises.unlink(abs) } catch (e) {
    if (e.code !== 'ENOENT') return false // 权限/占用等暂时性失败保留清理任务，稍后重试。
  }
  return true
}

module.exports = { findMedia, unlinkUploads }
