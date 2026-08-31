function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ code: 403, message: '权限不足' })
    }
    next()
  }
}

module.exports = authorize
