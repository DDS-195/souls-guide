const { AsyncLocalStorage } = require('async_hooks')
const context = new AsyncLocalStorage()
async function record(db, data = {}, overrides = {}) {
  const current = context.getStore()
  if (!current) return
  await current.record(db, data, overrides)
  current.recorded = true
}
function skip() { const current = context.getStore(); if (current) current.recorded = true }
module.exports = { context, record, skip }
