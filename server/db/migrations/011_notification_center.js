module.exports = {
  version: '011_notification_center',
  async up(db) {
    for (const [name, type] of [['context_title','VARCHAR(200)'], ['comment_id','INT']]) {
      const [rows] = await db.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME=?", [name])
      if (!rows.length) await db.execute(`ALTER TABLE notifications ADD COLUMN ${name} ${type} NULL`)
    }
    for (const [name, columns] of [
      ['idx_notifications_receiver_created','receiver_id,created_at,id'],
      ['idx_notifications_dedupe','receiver_id,sender_id,type,target_id,created_at'],
    ]) {
      const [rows] = await db.execute('SHOW INDEX FROM notifications WHERE Key_name=?', [name])
      if (!rows.length) await db.execute(`ALTER TABLE notifications ADD KEY ${name} (${columns})`)
    }
  },
}
