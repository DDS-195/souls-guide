const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reserve } = require('../src/utils/storageBudget')
const createQueue = require('../src/utils/workQueue')
const pause = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('storage reservations serialize concurrent admission and release exactly once', async () => {
  const options = { env: { NODE_ENV: 'production', MIN_UPLOAD_FREE_MB: '0' }, statfs: async () => ({ bavail: 100, bsize: 1 }) }
  const results = await Promise.allSettled([reserve(60, options), reserve(60, options)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 503)
  const release = results.find(r => r.status === 'fulfilled').value
  release(); release()
  const full = await reserve(100, options); full()
})
test('failed disk probe does not deadlock the next check', async () => {
  const env = { NODE_ENV: 'production', MIN_UPLOAD_FREE_MB: '0' }
  await assert.rejects(reserve(1, { env, statfs: async () => { throw Error('disk down') } }))
  const release = await reserve(1, { env, statfs: async () => ({ bavail: 1, bsize: 1 }) }); release()
})
test('work queue bounds waiting tasks, preserves FIFO, and releases after failures', async () => {
  const queue = createQueue({ concurrency: 1, maxWaiting: 1, waitMs: 1000 }), gate = pause(), order = []
  const first = queue.run(async () => { order.push(1); await gate.promise; throw Error('failed job') })
  const rejected = assert.rejects(first, /failed job/)
  const second = queue.run(() => { order.push(2); return 42 })
  await assert.rejects(queue.run(() => 0), error => error.statusCode === 503)
  gate.resolve(); await rejected; assert.equal(await second, 42)
  assert.deepEqual(order, [1, 2]); assert.equal(await queue.run(() => 7), 7)
})
test('expired waiter is removed and never executes its job', async () => {
  const queue = createQueue({ concurrency: 1, maxWaiting: 1, waitMs: 10 }), gate = pause()
  const first = queue.run(() => gate.promise)
  let executed = false
  await assert.rejects(queue.run(() => { executed = true }), error => error.statusCode === 503)
  gate.resolve(); await first
  assert.equal(executed, false); assert.equal(await queue.run(() => 8), 8)
})
