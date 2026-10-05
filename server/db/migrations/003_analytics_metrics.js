async function hasColumn(db, table, column) {
  const [rows] = await db.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
    [table, column]
  )
  return rows.length > 0
}

async function hasIndex(db, table, indexName) {
  const [rows] = await db.execute(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`,
    [table, indexName]
  )
  return rows.length > 0
}

async function up(db) {
  if (!(await hasColumn(db, 'posts', 'published_at'))) {
    await db.execute('ALTER TABLE posts ADD COLUMN published_at DATETIME DEFAULT NULL AFTER status')
  }
  // 只能作为历史基线估算，不能据此生成伪造的每日互动趋势。
  await db.execute("UPDATE posts SET published_at=created_at WHERE status='published' AND published_at IS NULL")
  if (!(await hasIndex(db, 'posts', 'idx_posts_user_published'))) {
    await db.execute('ALTER TABLE posts ADD INDEX idx_posts_user_published (user_id, status, published_at)')
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_type ENUM('view','like','unlike','favorite','unfavorite','comment','comment_delete','follow','unfollow') NOT NULL,
      post_id INT DEFAULT NULL,
      author_id INT NOT NULL,
      actor_id INT DEFAULT NULL,
      visitor_key CHAR(64) DEFAULT NULL,
      event_value INT UNSIGNED NOT NULL DEFAULT 1,
      is_internal TINYINT(1) NOT NULL DEFAULT 0,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_analytics_author_time (author_id, occurred_at),
      KEY idx_analytics_post_time (post_id, occurred_at),
      KEY idx_analytics_type_time (event_type, occurred_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS analytics_daily_metrics (
      scope_type ENUM('post','creator') NOT NULL,
      scope_id INT NOT NULL,
      metric_date DATE NOT NULL,
      pv INT UNSIGNED NOT NULL DEFAULT 0,
      uv INT UNSIGNED NOT NULL DEFAULT 0,
      likes_added INT UNSIGNED NOT NULL DEFAULT 0,
      likes_removed INT UNSIGNED NOT NULL DEFAULT 0,
      favorites_added INT UNSIGNED NOT NULL DEFAULT 0,
      favorites_removed INT UNSIGNED NOT NULL DEFAULT 0,
      comments_added INT UNSIGNED NOT NULL DEFAULT 0,
      comments_removed INT UNSIGNED NOT NULL DEFAULT 0,
      followers_added INT UNSIGNED NOT NULL DEFAULT 0,
      followers_removed INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (scope_type, scope_id, metric_date),
      KEY idx_analytics_daily_date (metric_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS analytics_daily_visitors (
      scope_type ENUM('post','creator') NOT NULL,
      scope_id INT NOT NULL,
      metric_date DATE NOT NULL,
      visitor_key CHAR(64) NOT NULL,
      first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (scope_type, scope_id, metric_date, visitor_key),
      KEY idx_analytics_visitor_date (visitor_key, metric_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS analytics_view_sessions (
      post_id INT NOT NULL,
      visitor_key CHAR(64) NOT NULL,
      last_counted_at DATETIME NOT NULL,
      PRIMARY KEY (post_id, visitor_key),
      KEY idx_analytics_view_last (last_counted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
}

module.exports = { version: '003_analytics_metrics', up }
