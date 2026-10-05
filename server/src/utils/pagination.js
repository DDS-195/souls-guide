function badRequest(message) {
  const err = new Error(message)
  err.statusCode = 400
  err.code = 400
  throw err
}

function parseInteger(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback
  if (!/^\d+$/.test(String(value))) badRequest(`${name} 必须为正整数`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) badRequest(`${name} 必须为正整数`)
  return parsed
}

function parsePagination(query, { defaultPageSize = 10, maxPageSize = 50 } = {}) {
  const page = parseInteger(query.page, 1, 'page')
  const requestedSize = parseInteger(query.pageSize, defaultPageSize, 'pageSize')
  return { page, pageSize: Math.min(requestedSize, maxPageSize) }
}

module.exports = parsePagination
