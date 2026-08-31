// Express 4 不捕获 async handler 的 rejected promise（会导致 unhandledRejection 直接崩溃进程）。
// 包装：异常统一流转到 next(err) → errorHandler（500 信封）。
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

module.exports = asyncHandler
