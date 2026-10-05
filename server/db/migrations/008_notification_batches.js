module.exports = {
  version: '008_notification_batches',
  async up(db) {
    await db.execute(`CREATE TABLE IF NOT EXISTS notification_batches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      admin_id INT NOT NULL,
      admin_username VARCHAR(50) NOT NULL,
      request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      scope ENUM('user','all') NOT NULL,
      target_user_id INT DEFAULT NULL,
      target_label VARCHAR(150) DEFAULT NULL,
      content VARCHAR(300) NOT NULL,
      recipient_count INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_notification_request (admin_id,request_id),
      KEY idx_notification_actor_time (admin_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  },
}
