module.exports = {
  version: '015_analytics_capacity',
  async up(db) {
    for (const [table, name, columns] of [
      ['analytics_daily_visitors', 'idx_analytics_visitors_date', 'metric_date'],
      ['analytics_events', 'idx_analytics_reader_scope', 'author_id,event_type,is_internal,occurred_at,actor_id,post_id'],
    ]) {
      const [rows] = await db.execute('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [table, name])
      if (!rows.length) await db.execute(`ALTER TABLE ${table} ADD INDEX ${name} (${columns})`)
    }
  },
}
