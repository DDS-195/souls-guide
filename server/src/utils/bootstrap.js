const bcrypt = require('bcrypt')
const pool = require('../config/db')

const PUBLIC_DEV_PASSWORD = 'admin123'

function assertJwtSecret() {
  const secret = process.env.JWT_SECRET || ''
  if (!secret) throw new Error('JWT_SECRET 未配置，服务拒绝启动')
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('生产环境 JWT_SECRET 至少需要 32 个字符')
  }
}

function validateInitialPassword(password) {
  if (!password || password.length < 12 || password.length > 72) {
    throw new Error('ADMIN_INITIAL_PASSWORD 必须为 12~72 个字符')
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('ADMIN_INITIAL_PASSWORD 必须同时包含大小写字母、数字和特殊字符')
  }
}

async function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin'
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || ''
  const [[admin]] = await pool.execute('SELECT id, password FROM users WHERE username = ?', [username])

  if (!admin) {
    if (!initialPassword) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('生产环境缺少 ADMIN_INITIAL_PASSWORD，无法创建初始管理员')
      }
      console.warn('[security] 未创建管理员；如需管理端，请设置 ADMIN_INITIAL_PASSWORD 后重启')
      return
    }
    validateInitialPassword(initialPassword)
    const hashed = await bcrypt.hash(initialPassword, 12)
    await pool.execute(
      "INSERT INTO users (username, password, role, apply_status) VALUES (?, ?, 'admin', 'approved')",
      [username, hashed]
    )
    console.log(`[security] 已创建初始管理员 ${username}；请登录后立即修改密码并移除初始化变量`)
    return
  }

  const usesPublicPassword = await bcrypt.compare(PUBLIC_DEV_PASSWORD, admin.password)
  if (!usesPublicPassword) return
  if (!initialPassword) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('检测到公开默认管理员密码；请设置 ADMIN_INITIAL_PASSWORD 后再启动生产服务')
    }
    console.warn('[security] 当前仅开发环境仍使用公开管理员密码，禁止用于公网部署')
    return
  }
  validateInitialPassword(initialPassword)
  const hashed = await bcrypt.hash(initialPassword, 12)
  await pool.execute('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?', [hashed, admin.id])
  console.log('[security] 已替换公开默认管理员密码，历史登录令牌已失效')
}

async function bootstrap() {
  assertJwtSecret()
  await bootstrapAdmin()
}

module.exports = bootstrap
