const crypto = require('crypto')

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/

module.exports = function requestId(req, res, next) {
  const incoming = req.get('x-request-id')
  req.id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()
  res.set('X-Request-Id', req.id)
  next()
}
