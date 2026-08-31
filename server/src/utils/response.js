function success(res, data, message = 'success') {
  res.json({ code: 0, message, data })
}

function paginated(res, { total, page, pageSize, list }) {
  res.json({ code: 0, message: 'success', data: { total, page, pageSize, list } })
}

function error(res, message, code = -1, statusCode = 400) {
  res.status(statusCode).json({ code, message, data: null })
}

module.exports = { success, paginated, error }
