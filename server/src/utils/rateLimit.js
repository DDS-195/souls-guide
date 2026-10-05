// 2026-08-13（P2-7）：简易内存限流（零依赖，R2 合规）——防登录/注册暴力破解。
// 实现：IP → { count, resetAt } 滑动窗口；超限返回 429 信封格式（4.0 契约）。
// 边界说明：单实例内存态，重启即清零；生产多实例部署需换共享存储（redis 等）——当前 Docker 单容器够用。
// 响应必须手写（本中间件在 response.js 输出链之外），格式与 4.0 信封一致。
/**
 * @param {{ windowMs?: number, max?: number, message?: string }} opts
 * windowMs：窗口时长（默认 60s）；max：窗口内最大次数（默认 20）；message：超限提示
 */
function rateLimit({ windowMs = 60 * 1000, max = 20, message = '操作过于频繁，请稍后再试' } = {}) {
  // 每个 limiter 独立计数，避免登录和阅读上报等不同业务互相消耗额度。
  const hits = new Map()
  setInterval(() => {
    const now = Date.now()
    for (const [key, value] of hits) {
      if (value.resetAt <= now) hits.delete(key)
    }
  }, Math.min(windowMs, 60 * 1000)).unref()
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const now = Date.now()
    const hit = hits.get(ip)
    if (!hit || hit.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs })
      return next()
    }
    hit.count += 1
    if (hit.count > max) {
      return res.status(429).json({ code: 429, message, data: null })
    }
    next()
  }
}

module.exports = rateLimit
