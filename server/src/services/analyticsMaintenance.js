const pool = require('../config/db')

// Only ephemeral deduplication state is removed. Facts, aggregates and user
// notifications are retained; historical UV must never be rebuilt by summing days.
async function cleanupTransientAnalytics({ db = pool, limit = 500 } = {}) {
  const size = String(Math.max(1, Math.min(Number(limit) || 500, 500)))
  const [sessions] = await db.execute('DELETE FROM analytics_view_sessions WHERE last_counted_at<DATE_SUB(NOW(), INTERVAL 1 DAY) ORDER BY last_counted_at LIMIT ?', [size])
  const [visitors] = await db.execute('DELETE FROM analytics_daily_visitors WHERE metric_date<DATE_SUB(CURDATE(), INTERVAL 7 DAY) ORDER BY metric_date LIMIT ?', [size])
  return { sessions: sessions.affectedRows, visitors: visitors.affectedRows }
}
module.exports = { cleanupTransientAnalytics }
