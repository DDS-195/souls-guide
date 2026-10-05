module.exports = {
  version: '012_comment_pagination',
  async up(db) {
    for (const [name, columns] of [
      ['idx_comments_parent_created', 'parent_id,created_at,id'],
      ['idx_comments_post_parent_created', 'post_id,parent_id,created_at,id'],
    ]) {
      const [rows] = await db.execute('SHOW INDEX FROM comments WHERE Key_name=?', [name])
      if (!rows.length) await db.execute(`ALTER TABLE comments ADD KEY ${name} (${columns})`)
    }
  },
}
