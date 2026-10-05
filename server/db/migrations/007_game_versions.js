module.exports = {
  version: '007_game_versions',
  async up(db) {
    const [columns] = await db.execute("SHOW COLUMNS FROM games LIKE 'version'")
    if (!columns.length) await db.execute('ALTER TABLE games ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1')
    await db.execute(`CREATE TABLE IF NOT EXISTS game_cover_cleanup (
      url VARCHAR(500) PRIMARY KEY, queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  },
}
