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
  await db.execute(
    "ALTER TABLE announcements MODIFY status ENUM('draft','published','archived','deleted') NOT NULL DEFAULT 'draft'"
  )
  if (!(await hasColumn(db, 'announcements', 'version'))) {
    await db.execute('ALTER TABLE announcements ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER status')
  }
  if (!(await hasColumn(db, 'announcements', 'source_id'))) {
    await db.execute('ALTER TABLE announcements ADD COLUMN source_id INT DEFAULT NULL AFTER version')
  }
  if (!(await hasColumn(db, 'announcements', 'published_at'))) {
    await db.execute('ALTER TABLE announcements ADD COLUMN published_at DATETIME DEFAULT NULL AFTER source_id')
  }
  if (!(await hasColumn(db, 'announcements', 'archived_at'))) {
    await db.execute('ALTER TABLE announcements ADD COLUMN archived_at DATETIME DEFAULT NULL AFTER published_at')
  }
  if (!(await hasColumn(db, 'announcements', 'deleted_at'))) {
    await db.execute('ALTER TABLE announcements ADD COLUMN deleted_at DATETIME DEFAULT NULL AFTER archived_at')
  }
  await db.execute("UPDATE announcements SET published_at=created_at WHERE status IN ('published','archived') AND published_at IS NULL")
  await db.execute("UPDATE announcements SET archived_at=updated_at WHERE status='archived' AND archived_at IS NULL")

  if (!(await hasIndex(db, 'announcements', 'idx_announcements_status_created'))) {
    await db.execute('ALTER TABLE announcements ADD INDEX idx_announcements_status_created (status, deleted_at, created_at)')
  }
  if (!(await hasIndex(db, 'announcements', 'idx_announcements_published'))) {
    await db.execute('ALTER TABLE announcements ADD INDEX idx_announcements_published (published_at, id)')
  }
  if (!(await hasIndex(db, 'announcements', 'idx_announcements_source'))) {
    await db.execute('ALTER TABLE announcements ADD INDEX idx_announcements_source (source_id)')
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS announcement_channels (
      channel VARCHAR(32) PRIMARY KEY,
      current_announcement_id INT DEFAULT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_announcement_channel_current
        FOREIGN KEY (current_announcement_id) REFERENCES announcements(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS announcement_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      announcement_id INT NOT NULL,
      actor_id INT DEFAULT NULL,
      actor_username VARCHAR(50) NOT NULL,
      action ENUM('create','update','publish','archive','delete','clone') NOT NULL,
      from_status ENUM('draft','published','archived','deleted') DEFAULT NULL,
      to_status ENUM('draft','published','archived','deleted') NOT NULL,
      version INT UNSIGNED NOT NULL,
      title_snapshot VARCHAR(200) NOT NULL,
      content_snapshot TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_announcement_events_target (announcement_id, created_at),
      KEY idx_announcement_events_actor (actor_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id INT NOT NULL,
      user_id INT NOT NULL,
      version INT UNSIGNED NOT NULL,
      read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (announcement_id, user_id, version),
      KEY idx_announcement_reads_user (user_id, read_at),
      CONSTRAINT fk_announcement_reads_announcement
        FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
      CONSTRAINT fk_announcement_reads_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  const [[current]] = await db.execute(
    "SELECT id FROM announcements WHERE status='published' AND deleted_at IS NULL ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 1"
  )
  if (current) {
    await db.execute(
      "UPDATE announcements SET status='archived', archived_at=COALESCE(archived_at, NOW()) WHERE status='published' AND id<>?",
      [current.id]
    )
  }
  await db.execute(
    `INSERT INTO announcement_channels (channel, current_announcement_id)
     VALUES ('global', ?)
     ON DUPLICATE KEY UPDATE current_announcement_id=VALUES(current_announcement_id)`,
    [current ? current.id : null]
  )
}

module.exports = { version: '004_announcement_lifecycle', up }
