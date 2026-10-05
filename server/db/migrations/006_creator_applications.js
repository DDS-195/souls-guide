module.exports = {
  version: '006_creator_applications',
  async up(db) {
    await db.execute(`CREATE TABLE IF NOT EXISTS creator_applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      reason VARCHAR(500) NOT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      submitted_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      reviewer_id INT NULL,
      reviewer_username VARCHAR(50) NULL,
      reject_reason VARCHAR(500) NULL,
      legacy TINYINT NOT NULL DEFAULT 0,
      pending_user_id INT NULL,
      UNIQUE KEY uq_pending_user (pending_user_id),
      INDEX ix_queue (status,submitted_at,id),
      INDEX ix_user (user_id,id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    // 无法还原历史提交时间及审核人，不使用用户更新时间冒充。
    await db.execute(`INSERT INTO creator_applications (user_id,reason,status,submitted_at,legacy,pending_user_id)
      SELECT u.id,COALESCE(u.apply_reason,''),u.apply_status,NULL,1,CASE WHEN u.apply_status='pending' THEN u.id ELSE NULL END FROM users u
      WHERE u.apply_status IN ('pending','approved','rejected') AND u.role<>'admin'
      AND NOT EXISTS (SELECT 1 FROM creator_applications a WHERE a.user_id=u.id)`)
  },
}
