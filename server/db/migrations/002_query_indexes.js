async function hasIndex(db, table, indexName) {
  const [rows] = await db.execute(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1`,
    [table, indexName]
  )
  return rows.length > 0
}

async function addIndex(db, table, indexName, columns) {
  if (!(await hasIndex(db, table, indexName))) {
    await db.execute(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columns})`)
  }
}

async function up(db) {
  await addIndex(db, 'posts', 'idx_posts_status_created', '`status`, `created_at`')
  await addIndex(db, 'posts', 'idx_posts_game_status_created', '`game_id`, `status`, `created_at`')
  await addIndex(db, 'posts', 'idx_posts_user_status_created', '`user_id`, `status`, `created_at`')
  await addIndex(db, 'comments', 'idx_comments_post_created', '`post_id`, `created_at`')
  await addIndex(db, 'notifications', 'idx_notifications_receiver_read_created', '`receiver_id`, `is_read`, `created_at`')
  await addIndex(db, 'favorites', 'idx_favorites_user_created', '`user_id`, `created_at`')
  await addIndex(db, 'follows', 'idx_follows_following_created', '`following_id`, `created_at`')

  // 旧基线创建过 ft_title，但实际查询一直使用 LIKE；无 ngram 配置时该索引也不能可靠覆盖中文搜索。
  if (await hasIndex(db, 'posts', 'ft_title')) {
    await db.execute('ALTER TABLE posts DROP INDEX ft_title')
  }
}

module.exports = { version: '002_query_indexes', up }
