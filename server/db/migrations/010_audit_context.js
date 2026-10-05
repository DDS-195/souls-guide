module.exports = {
  version: '010_audit_context',
  async up(db) {
    for (const [name, type] of [['request_id','VARCHAR(128)'],['event_key','VARCHAR(100)'],['metadata','JSON']]) {
      const [rows] = await db.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='operation_logs' AND COLUMN_NAME=?", [name])
      if (!rows.length) await db.execute('ALTER TABLE operation_logs ADD COLUMN ' + name + ' ' + type + ' NULL')
    }
    const [indexes] = await db.execute("SHOW INDEX FROM operation_logs WHERE Key_name='uq_operation_event'")
    if (!indexes.length) await db.execute('ALTER TABLE operation_logs ADD UNIQUE KEY uq_operation_event (event_key), ADD KEY idx_operation_request (request_id), ADD KEY idx_operation_target (target_type,target_id)')
  },
}
