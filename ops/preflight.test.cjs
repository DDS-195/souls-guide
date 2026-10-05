const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { validateCompose, validateCertificate } = require('./preflight.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
function config() {
  const secret = () => randomBytes(32).toString('hex')
  const env = { NODE_ENV: 'production', DB_HOST: 'mysql', DB_NAME: 'souls_guide', DB_USER: 'app', DB_PASSWORD: secret(), JWT_SECRET: secret(), ANALYTICS_SALT: secret(), TRUST_PROXY_HOPS: '1', PUBLIC_ORIGIN: 'https://community.test', SITE_HOST: 'community.test' }
  return { services: {
    server: { environment: env },
    mysql: { environment: { MYSQL_ROOT_PASSWORD: secret(), MYSQL_USER: 'app', MYSQL_PASSWORD: env.DB_PASSWORD } },
    nginx: { environment: { SITE_HOST: 'community.test' }, ports: [{ published: '80', target: 80 }, { published: '443', target: 443 }], volumes: [{ type: 'bind', target: '/etc/nginx/certs', source: '/test/certs', read_only: true }] },
  } }
}
test('正确的生产配置通过静态检查', () => assert.equal(validateCompose(config()).host, 'community.test'))
test('IP HTTP显式启用后免证书，端口必须匹配', () => {
  const c = config()
  Object.assign(c.services.server.environment, { ALLOW_INSECURE_HTTP: 'true', SITE_HOST: '192.0.2.1', PUBLIC_ORIGIN: 'http://192.0.2.1:8080' })
  c.services.nginx.environment.SITE_HOST = '192.0.2.1'
  c.services.nginx.ports = [{ published: '8080', target: 80 }]
  c.services.nginx.volumes = []
  assert.equal(validateCompose(c).insecureHttp, true)
  c.services.nginx.ports[0].published = '80'
  assert.throws(() => validateCompose(c), /端口/)
})
test('HTTP不能隐式降级或绕过生产密钥校验', () => {
  const c = config()
  Object.assign(c.services.server.environment, { SITE_HOST: '192.0.2.1', PUBLIC_ORIGIN: 'http://192.0.2.1' })
  assert.throws(() => validateCompose(c), /HTTPS/)
  c.services.server.environment.ALLOW_INSECURE_HTTP = 'true'
  c.services.server.environment.JWT_SECRET = 'CHANGE_ME_at_least_32_random_characters'
  assert.throws(() => validateCompose(c), /JWT_SECRET/)
})
test('禁止数据库和应用公开端口', () => {
  for (const service of ['server', 'mysql']) {
    const c = config(); c.services[service].ports = [{ published: '3000', target: 3000 }]
    assert.throws(() => validateCompose(c), /公开/)
  }
})
test('拒绝开发环境和弱root密码', () => {
  const c = config(); c.services.server.environment.NODE_ENV = 'development'
  assert.throws(() => validateCompose(c), /生产/)
  c.services.server.environment.NODE_ENV = 'production'
  c.services.mysql.environment.MYSQL_ROOT_PASSWORD = 'CHANGE_ME_database_root_password'
  assert.throws(() => validateCompose(c), /root/)
})
test('拒绝错配的数据库账号', () => {
  const c = config(); c.services.mysql.environment.MYSQL_USER = 'different'
  assert.throws(() => validateCompose(c), /不一致/)
})
test('拒绝可写证书、错配域名和特权容器', () => {
  let c = config(); c.services.nginx.volumes[0].read_only = false
  assert.throws(() => validateCompose(c), /只读/)
  c = config(); c.services.nginx.environment.SITE_HOST = 'other.test'
  assert.throws(() => validateCompose(c), /域名/)
  c = config(); c.services.server.privileged = true
  assert.throws(() => validateCompose(c), /特权/)
})
test('证书检查覆盖匹配、错误域名、临期和错误私钥', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cert-test-'))
  try {
    const key = path.join(directory, 'key.pem'), pem = path.join(directory, 'cert.pem')
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=community.test', '-addext', 'subjectAltName=DNS:community.test', '-keyout', key, '-out', pem], { stdio: 'ignore' })
    const certificate = fs.readFileSync(pem), privateKey = fs.readFileSync(key)
    assert.ok(validateCertificate(certificate, privateKey, 'community.test') >= 28)
    assert.throws(() => validateCertificate(certificate, privateKey, 'other.test'), /域名/)
    assert.throws(() => validateCertificate(certificate, privateKey, 'community.test', Date.now() + 25 * 86400000), /过期/)
    const other = require('node:crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
    assert.throws(() => validateCertificate(certificate, other, 'community.test'), /私钥/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
