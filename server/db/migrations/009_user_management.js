module.exports = {
  version: '009_user_management',
  async up(db) {
    const [columns] = await db.execute("SHOW COLUMNS FROM users LIKE 'management_version'")
    if (!columns.length) await db.execute('ALTER TABLE users ADD COLUMN management_version INT NOT NULL DEFAULT 1')
    const [deleted] = await db.execute("SHOW COLUMNS FROM comments LIKE 'is_deleted'")
    if (!deleted.length) await db.execute('ALTER TABLE comments ADD COLUMN is_deleted TINYINT NOT NULL DEFAULT 0')
    const [keys] = await db.execute(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='comments' AND COLUMN_NAME='user_id' AND REFERENCED_TABLE_NAME='users'`)
    for (const key of keys) await db.execute('ALTER TABLE comments DROP FOREIGN KEY `' + key.CONSTRAINT_NAME.replace(/`/g, '``') + '`')
    await db.execute('ALTER TABLE comments MODIFY user_id INT NULL')
    await db.execute('ALTER TABLE comments ADD CONSTRAINT fk_comment_user_retained FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL')
    await db.execute(`CREATE TABLE IF NOT EXISTS user_management_events (
      id INT AUTO_INCREMENT PRIMARY KEY, actor_id INT NOT NULL, actor_username VARCHAR(50) NOT NULL,
      user_id INT NOT NULL, username VARCHAR(50) NOT NULL, action VARCHAR(20) NOT NULL,
      reason VARCHAR(300) NOT NULL, detail JSON NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await db.execute(`CREATE TABLE IF NOT EXISTS user_asset_cleanup (
      url VARCHAR(500) COLLATE utf8mb4_bin PRIMARY KEY, queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  },
}
