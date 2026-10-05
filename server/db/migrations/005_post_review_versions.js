async function up(db) {
  const [columns] = await db.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='posts'")
  const names = new Set(columns.map(row => row.COLUMN_NAME))
  if (!names.has('content_version')) await db.execute('ALTER TABLE posts ADD COLUMN content_version INT UNSIGNED NOT NULL DEFAULT 1')
  if (!names.has('submitted_at')) await db.execute('ALTER TABLE posts ADD COLUMN submitted_at DATETIME DEFAULT NULL')
  // 旧数据没有真实提交时间，保留 NULL；页面明确标注，队列临时按创建时间回退。
  const [indexes] = await db.execute("SHOW INDEX FROM posts WHERE Key_name='idx_posts_review_queue'")
  if (!indexes.length) await db.execute('ALTER TABLE posts ADD INDEX idx_posts_review_queue (status, submitted_at, id)')
  await db.execute(`CREATE TABLE IF NOT EXISTS post_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  content_version INT UNSIGNED NOT NULL,
  reviewer_id INT NOT NULL,
  reviewer_username VARCHAR(50) NOT NULL,
  decision ENUM('published','rejected') NOT NULL,
  reason VARCHAR(200) DEFAULT NULL,
  snapshot JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_post_review_version (post_id, content_version),
  KEY idx_post_reviews_post (post_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

module.exports = { version: '005_post_review_versions', up }
