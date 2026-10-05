#!/usr/bin/env node
// 只读取 Compose 的最终配置；不启动容器、不改密钥，不回显含凭证的配置。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { X509Certificate, createPrivateKey } = require('node:crypto')
const validateProduction = require('../server/src/utils/productionConfig')

function validateCompose(config) {
  const services = config.services || {}
  const server = services.server || {}
  const env = server.environment || {}
  if (env.NODE_ENV !== 'production') throw new Error('未启用生产 Compose 配置')
  validateProduction(env)
  const mysql = services.mysql || {}
  const root = mysql.environment?.MYSQL_ROOT_PASSWORD || ''
  if (root.length < 16 || new Set(root).size < 8 || /change[ _-]?me|example|password|admin123/i.test(root)) throw new Error('数据库 root 密码必须替换为随机生产密码')
  if ([env.DB_PASSWORD, env.JWT_SECRET, env.ANALYTICS_SALT, env.ADMIN_INITIAL_PASSWORD].includes(root)) throw new Error('数据库 root 密码不得复用')
  if (env.DB_USER !== mysql.environment?.MYSQL_USER || env.DB_PASSWORD !== mysql.environment?.MYSQL_PASSWORD) throw new Error('应用与数据库初始化账号配置不一致')
  if (server.ports?.length || mysql.ports?.length || server.network_mode === 'host' || mysql.network_mode === 'host') throw new Error('禁止向宿主机公开数据库或后端服务')
  if (server.privileged) throw new Error('应用禁止使用特权容器')
  const nginx = services.nginx || {}
  if (nginx.environment?.SITE_HOST !== env.SITE_HOST) throw new Error('Nginx与应用域名不一致')
  const ports = nginx.ports || []
  if (env.ALLOW_INSECURE_HTTP === 'true') {
    const port = Number(new URL(env.PUBLIC_ORIGIN).port || 80)
    if (ports.length !== 1 || Number(ports[0].target) !== 80 || Number(ports[0].published) !== port) throw new Error('HTTP源地址端口与Nginx公开端口不一致')
    return { host: env.SITE_HOST, insecureHttp: true }
  }
  if (!ports.some(p => String(p.published) === '443' && Number(p.target) === 443)) throw new Error('未映射标准 HTTPS 端口')
  if (ports.some(p => ![80, 443].includes(Number(p.published)) || Number(p.published) !== Number(p.target))) throw new Error('生产Nginx仅允许80/443对应端口映射')
  const certMount = nginx.volumes?.find(v => v.type === 'bind' && v.target === '/etc/nginx/certs')
  if (!certMount?.source || !certMount.read_only) throw new Error('证书目录必须以只读方式挂载')
  return { host: env.SITE_HOST, certificateDirectory: certMount.source }
}

function validateCertificate(pem, keyPem, host, now = Date.now()) {
  const cert = new X509Certificate(pem)
  if (!cert.checkHost(host)) throw new Error('证书不匹配网站域名')
  if (!cert.checkPrivateKey(createPrivateKey(keyPem))) throw new Error('证书与私钥不匹配')
  if (Date.parse(cert.validFrom) > now) throw new Error('证书尚未生效')
  const remainingDays = Math.floor((Date.parse(cert.validTo) - now) / 86400000)
  if (remainingDays < 7) throw new Error('证书已过期或将在7天内过期，请先续期')
  return remainingDays
}

function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('请使用项目约定的Node 24')
  const httpMode = process.argv.includes('--http')
  const result = spawnSync('docker', ['compose', '-f', 'docker-compose.yml', '-f', httpMode ? 'docker-compose.prod-http.yml' : 'docker-compose.prod.yml', 'config', '--format', 'json'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('无法读取生产Compose配置，请检查Docker安装、环境变量和Compose配置；未输出配置以避免泄露密钥')
  let config
  try { config = JSON.parse(result.stdout) } catch { throw new Error('Compose未返回有效JSON配置；为保护凭证不回显原始输出') }
  const { host, certificateDirectory, insecureHttp } = validateCompose(config)
  if (insecureHttp) {
    console.warn('HTTP演示配置静态预检通过；无证书、无加密，密码和令牌可能被窃取。仅用于受限测试。仍需服务器启动与数据恢复验收。')
    return
  }
  let days
  try {
    days = validateCertificate(fs.readFileSync(path.join(certificateDirectory, 'fullchain.pem')), fs.readFileSync(path.join(certificateDirectory, 'privkey.pem')), host)
  } catch (err) {
    if (err.code) throw new Error('证书文件读取或解析失败，请检查PEM格式和权限')
    throw err
  }
  console.log(`部署静态预检通过；证书剩余${days}天。仍需验证证书信任链、DNS、公网TLS、防火墙、备份恢复与真实视频。`)
}
if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { validateCompose, validateCertificate }
