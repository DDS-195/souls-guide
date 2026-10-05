const H = require('./helpers')
const crypto = require('crypto')
const { EventEmitter } = require('events')
module.exports = async function () {
  const validate = require('../src/utils/productionConfig')
  const valid = () => ({ NODE_ENV: 'production', JWT_SECRET: crypto.randomBytes(32).toString('hex'), ANALYTICS_SALT: crypto.randomBytes(32).toString('hex'), DB_PASSWORD: crypto.randomBytes(24).toString('hex'), DB_HOST: 'mysql', DB_NAME: 'souls_guide', DB_USER: 'souls_guide_app', TRUST_PROXY_HOPS: '1', PUBLIC_ORIGIN: 'https://community.test', SITE_HOST: 'community.test' })
  await H.test('生产配置拒绝示例密钥、root、跨域配置和禁用媒体检测', async () => {
    H.assert.doesNotThrow(() => validate(valid()))
    for (const change of [{ JWT_SECRET: 'CHANGE_ME_at_least_32_random_characters' }, { DB_USER: 'root' }, { ANALYTICS_SALT: '' }, { SKIP_MEDIA_PROBE: 'true' }, { PUBLIC_ORIGIN: 'http://community.test' }, { SITE_HOST: 'other.test' }, { MIN_UPLOAD_FREE_MB: '-1' }]) H.assert.throws(() => validate({ ...valid(), ...change }))
    const same = valid(); same.ANALYTICS_SALT = same.JWT_SECRET
    H.assert.throws(() => validate(same))
  })
  await H.test('就绪检查实际访问数据库，故障返回503且不泄露细节', async () => {
    const ready = await fetch('http://127.0.0.1:3199/health/ready')
    H.assert.equal(ready.status, 200)
    const original = H.pool.query
    try {
      H.pool.query = async () => { throw new Error('private db detail') }
      const failed = await fetch('http://127.0.0.1:3199/health/ready')
      H.assert.equal(failed.status, 503)
      H.assert.equal((await failed.text()).includes('private'), false)
    } finally { H.pool.query = original }
  })
  await H.test('上传空间不足拒绝写入，并发额度完成后释放', async () => {
    const create = require('../src/middlewares/uploadCapacity')
    const req = { method: 'POST', path: '/api/media/upload/image', is: () => true }
    const response = () => Object.assign(new EventEmitter(), { status(code) { this.code = code; return this }, set() { return this }, json() { this.emit('finish'); return this } })
    let passed = 0
    const low = create({ env: { NODE_ENV: 'production' }, statfs: async () => ({ bavail: 0, bsize: 4096 }) })
    const denied = response(); await low(req, denied, () => passed++)
    H.assert.equal(denied.code, 503); H.assert.equal(passed, 0)
    const normal = create({ env: { NODE_ENV: 'production' }, statfs: async () => ({ bavail: 10000000, bsize: 4096 }) })
    const first = response()
    await normal(req, first, () => passed++)
    for (let i = 0; i < 5; i++) await normal(req, response(), () => passed++)
    const busy = response(); await normal(req, busy, () => passed++)
    H.assert.equal(busy.code, 503); H.assert.equal(passed, 6)
    first.emit('finish'); first.emit('close')
    await normal(req, response(), () => passed++)
    H.assert.equal(passed, 7)
  })
}
