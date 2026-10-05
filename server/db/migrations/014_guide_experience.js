module.exports = {
  version: '014_guide_experience',
  async up(db) {
    const [columns] = await db.execute("SHOW COLUMNS FROM posts LIKE 'guide_info'")
    if (!columns.length) await db.execute('ALTER TABLE posts ADD COLUMN guide_info JSON NULL')
  },
}
