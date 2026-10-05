module.exports = {
  version: '013_post_writing',
  async up(db) {
    await db.execute(`CREATE TABLE IF NOT EXISTS post_create_requests (
      user_id INT NOT NULL,
      request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      post_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id,request_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  },
}
