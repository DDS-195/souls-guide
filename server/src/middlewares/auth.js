const jwt = require('jsonwebtoken')
const pool = require('../config/db')

async function auth(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ code: 401, message: '请先登录', data: null })
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    // 封禁/删除校验（设计文档 4.2：auth 中间件查库校验状态，status=0 拒绝）
    // 2026-08-13 修复（P2-3）：同时查 role 并覆盖 token 内的旧角色——角色变更（创作者审批通过/被撤）
    // 下一次请求即实时生效，无需等待 7 天 token 过期或重新登录
    const [[user]] = await pool.execute('SELECT status, role, token_version FROM users WHERE id = ?', [req.user.id])
    if (!user) return res.status(401).json({ code: 401, message: 'token 无效或已过期', data: null })
    if (user.status === 0) return res.status(403).json({ code: 403, message: '账号已被封禁', data: null })
    if ((req.user.ver || 0) !== user.token_version) {
      return res.status(401).json({ code: 401, message: '登录状态已失效，请重新登录', data: null })
    }
    req.user.role = user.role
    require('../utils/mediaSession').issue(res, req.user)
    next()
  } catch (err) {
    if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(err.name)) return next(err)
    return res.status(401).json({ code: 401, message: 'token 无效或已过期', data: null })
  }
}

// 可选鉴权（追加）：公开接口携带**有效且未封禁** token 时挂 req.user（如 D19 主页 is_followed）；
// 无 token / 无效 / 已封禁 → 按游客放行，不强制鉴权
async function authOptional(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return next()
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const [[user]] = await pool.execute('SELECT status, role, token_version FROM users WHERE id = ?', [payload.id])
    if (user && user.status === 1 && (payload.ver || 0) === user.token_version) {
      req.user = { id: payload.id, username: payload.username, role: user.role, ver: user.token_version }
    }
  } catch (err) {
    if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(err.name)) return next(err)
  }
  next()
}

module.exports = auth
module.exports.authOptional = authOptional
