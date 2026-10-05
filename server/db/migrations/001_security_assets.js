async function hasColumn(db, table, column) {
  const [rows] = await db.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  )
  return rows.length > 0
}

async function up(db) {
  if (!(await hasColumn(db, 'users', 'token_version'))) {
    await db.execute('ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0 AFTER status')
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS upload_assets (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      owner_id   INT NOT NULL,
      url        VARCHAR(500) NOT NULL,
      hash       CHAR(32) DEFAULT NULL,
      type       ENUM('image', 'video') NOT NULL,
      status     ENUM('temporary', 'attached', 'deleted') NOT NULL DEFAULT 'temporary',
      expires_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_asset_owner_url (owner_id, url),
      KEY idx_asset_url_status (url, status),
      KEY idx_asset_expiry (status, expires_at),
      CONSTRAINT fk_asset_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS post_assets (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      post_id    INT NOT NULL,
      asset_id   INT NOT NULL,
      usage_type ENUM('cover', 'content', 'video') NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_post_asset_usage (post_id, asset_id, usage_type),
      KEY idx_post_asset_asset (asset_id),
      CONSTRAINT fk_post_asset_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_post_asset_asset FOREIGN KEY (asset_id) REFERENCES upload_assets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // 回填已有文章引用。旧资产缺少真实上传时间，只能标记为已绑定；之后的新写入全部走所有权校验。
  await db.execute(`
    INSERT IGNORE INTO upload_assets (owner_id, url, type, status, expires_at)
    SELECT user_id, cover, 'image', 'attached', NULL
    FROM posts WHERE cover IS NOT NULL AND cover LIKE '/uploads/%'
  `)
  await db.execute(`
    INSERT IGNORE INTO upload_assets (owner_id, url, type, status, expires_at)
    SELECT p.user_id, m.url, m.type, 'attached', NULL
    FROM media m JOIN posts p ON p.id = m.post_id
    WHERE m.url LIKE '/uploads/%'
  `)
  await db.execute(`
    INSERT IGNORE INTO post_assets (post_id, asset_id, usage_type, sort_order)
    SELECT p.id, a.id, 'cover', 0
    FROM posts p JOIN upload_assets a ON a.owner_id = p.user_id AND BINARY a.url = BINARY p.cover
    WHERE p.cover IS NOT NULL AND p.cover LIKE '/uploads/%'
  `)
  await db.execute(`
    INSERT IGNORE INTO post_assets (post_id, asset_id, usage_type, sort_order)
    SELECT m.post_id, a.id, IF(m.type = 'video', 'video', 'content'), m.sort_order
    FROM media m
    JOIN posts p ON p.id = m.post_id
    JOIN upload_assets a ON a.owner_id = p.user_id AND BINARY a.url = BINARY m.url
    WHERE m.url LIKE '/uploads/%'
  `)
}

module.exports = { version: '001_security_assets', up }
