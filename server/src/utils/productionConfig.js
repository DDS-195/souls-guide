// 纯校验，不输出配置值；必须在迁移数据库前调用。
function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return
  const secrets = ['JWT_SECRET', 'ANALYTICS_SALT', 'DB_PASSWORD']
  for (const key of secrets) {
    const value = env[key] || ''
    const min = key === 'DB_PASSWORD' ? 16 : 32
    if (value.length < min || /change[ _-]?me|example|password|admin123/i.test(value) || new Set(value).size < 8) {
      throw new Error(`${key} 必须替换为独立随机生产密钥`)
    }
  }
  if (new Set(secrets.map(key => env[key])).size !== secrets.length) throw new Error('生产密钥不得复用')
  if (!env.DB_USER || env.DB_USER.toLowerCase() === 'root') throw new Error('生产应用不得使用数据库 root 账号')
  if (!env.DB_HOST || !env.DB_NAME) throw new Error('生产数据库地址和名称不能为空')
  if (env.SKIP_MEDIA_PROBE === 'true') throw new Error('生产环境禁止跳过媒体检测')
  if (env.TRUST_PROXY_HOPS !== '1') throw new Error('当前生产拓扑要求一跳可信代理')
  if (!Number.isSafeInteger(Number(env.MIN_UPLOAD_FREE_MB || 2048)) || Number(env.MIN_UPLOAD_FREE_MB || 2048) < 512) throw new Error('上传磁盘预留至少为512MB整数')
  let origin
  try { origin = new URL(env.PUBLIC_ORIGIN) } catch { throw new Error('PUBLIC_ORIGIN 必须为网站 HTTPS 源地址') }
  const httpDemo = env.ALLOW_INSECURE_HTTP === 'true'
  if (httpDemo) {
    if (origin.protocol !== 'http:' || require('node:net').isIP(env.SITE_HOST || '') !== 4 || origin.hostname !== env.SITE_HOST) throw new Error('HTTP演示模式要求匹配的IPv4地址和http源地址')
  } else if (origin.protocol !== 'https:' || !env.SITE_HOST || origin.host !== env.SITE_HOST || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(env.SITE_HOST) || /\.(invalid|example)$/i.test(env.SITE_HOST)) {
    throw new Error('HTTPS模式要求与SITE_HOST一致的真实域名（标准443端口）')
  }
  if (origin.origin !== env.PUBLIC_ORIGIN || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN必须为不带路径或凭证的源地址')
  if (env.ADMIN_INITIAL_PASSWORD && (/change[ _-]?me|example|admin123/i.test(env.ADMIN_INITIAL_PASSWORD) || env.ADMIN_INITIAL_PASSWORD.length < 12)) throw new Error('管理员初始化密码不能使用示例值或弱密码')
}
module.exports = validateProductionConfig
