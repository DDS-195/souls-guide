async function up(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS post_revisions (
    post_id INT PRIMARY KEY,
    content_version INT UNSIGNED NOT NULL,
    status ENUM('pending','rejected') NOT NULL DEFAULT 'pending',
    payload JSON NOT NULL,
    reject_reason VARCHAR(200) DEFAULT NULL,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_revision_queue (status, submitted_at, post_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await db.execute(`CREATE TABLE IF NOT EXISTS post_revision_assets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    asset_id INT NOT NULL,
    usage_type ENUM('cover','content','video') NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_revision_asset_usage (post_id,asset_id,usage_type),
    KEY idx_revision_asset (asset_id),
    FOREIGN KEY (post_id) REFERENCES post_revisions(post_id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES upload_assets(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

module.exports = { version: '016_post_revisions', up }
