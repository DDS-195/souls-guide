-- SoulsGuide 建表脚本 v2.0（2026-08-07）
-- 权威来源：SoulsGuide-设计文档.md 第 3 章（13 张表，冻结规则：表名/字段/类型/约束一律以本章为准，不得改动）
-- 用法：mysql -u root -p < schema.sql （库名 souls_guide）

-- 强制导入会话 utf8mb4（MySQL 镜像初始化默认 latin1 连接，中文会双倍转码乱码）
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS souls_guide DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE souls_guide;

-- 3.1 users — 用户表
-- ⚠ D14（2026-08-07）：nickname/gender/birthday 三列已认可，与现有库对齐
CREATE TABLE users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(50) NOT NULL UNIQUE,
  password     VARCHAR(255) NOT NULL,
  avatar       VARCHAR(500) DEFAULT NULL,
  bio          VARCHAR(200) DEFAULT NULL,
  role         ENUM('user', 'creator', 'admin') DEFAULT 'user',
  apply_status ENUM('none', 'pending', 'approved', 'rejected') DEFAULT 'none',
  apply_reason VARCHAR(500) DEFAULT NULL,
  status       TINYINT DEFAULT 1,       -- 1=正常 0=封禁
  gender       VARCHAR(10) DEFAULT NULL,
  birthday     DATE DEFAULT NULL,
  nickname     VARCHAR(50) DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3.2 games — 游戏表
CREATE TABLE games (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  cover       VARCHAR(500) DEFAULT NULL,
  description VARCHAR(500) DEFAULT NULL,
  sort_order  INT DEFAULT 0,
  status      TINYINT DEFAULT 1,       -- 1=启用 0=停用
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3.3 posts — 攻略文章表
CREATE TABLE posts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  title          VARCHAR(200) NOT NULL,
  content        LONGTEXT NOT NULL,
  cover          VARCHAR(500) DEFAULT NULL,
  game_id        INT NOT NULL,
  category       VARCHAR(30) NOT NULL,
  status         ENUM('draft', 'pending', 'published', 'rejected') DEFAULT 'draft',
  reject_reason  VARCHAR(200) DEFAULT NULL,
  view_count     INT DEFAULT 0,
  like_count     INT DEFAULT 0,
  comment_count  INT DEFAULT 0,
  user_id        INT NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT
);

-- 3.4 tags — 标签表
CREATE TABLE tags (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(30) NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.5 post_tags — 文章-标签关联表
CREATE TABLE post_tags (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  tag_id  INT NOT NULL,
  UNIQUE KEY uk_post_tag (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 3.6 notifications — 通知表
CREATE TABLE notifications (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  receiver_id INT NOT NULL,
  sender_id   INT DEFAULT NULL,
  type        ENUM('like', 'comment', 'reply', 'follow', 'audit', 'system') NOT NULL,
  target_type VARCHAR(20) DEFAULT NULL,
  target_id   INT DEFAULT NULL,
  content     VARCHAR(300) NOT NULL,
  is_read     TINYINT DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 3.7 reports — 举报表
CREATE TABLE reports (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  target_type VARCHAR(20) NOT NULL,
  target_id   INT NOT NULL,
  reason      VARCHAR(500) NOT NULL,
  status      ENUM('pending', 'resolved', 'dismissed') DEFAULT 'pending',
  handler_id  INT DEFAULT NULL,
  handler_note VARCHAR(300) DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (handler_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 3.8 media — 媒体资源表
CREATE TABLE media (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  post_id    INT NOT NULL,
  url        VARCHAR(500) NOT NULL,
  type       ENUM('image', 'video') NOT NULL,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 3.9 comments — 评论表
CREATE TABLE comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  content    TEXT NOT NULL,
  user_id    INT NOT NULL,
  post_id    INT NOT NULL,
  parent_id  INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- 3.10 likes — 点赞表
CREATE TABLE likes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  post_id    INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_post (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 3.11 favorites — 收藏表
CREATE TABLE favorites (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  post_id    INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_post (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 3.12 follows — 关注表
CREATE TABLE follows (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  follower_id   INT NOT NULL,
  following_id  INT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_follow (follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3.13 announcements — 系统公告表
CREATE TABLE announcements (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  content    TEXT NOT NULL,
  author_id  INT NOT NULL,
  status     ENUM('draft', 'published', 'archived') DEFAULT 'draft',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- 3.14 operation_logs — 操作日志表（2026-08-09 D23，R4 唯一例外，用户批准）
-- 审计日志：无外键（用户删除后记录保留，admin_username 快照）；只增不改；写操作中间件自动记录
CREATE TABLE operation_logs (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  admin_id       INT NOT NULL,
  admin_username VARCHAR(50) NOT NULL,
  action         VARCHAR(50) NOT NULL,
  method         VARCHAR(10) NOT NULL,
  path           VARCHAR(200) NOT NULL,
  target_type    VARCHAR(30) DEFAULT NULL,
  target_id      INT DEFAULT NULL,
  detail         VARCHAR(500) DEFAULT NULL,
  ip             VARCHAR(45) DEFAULT NULL,
  status         INT NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created_at (created_at),
  KEY idx_admin_id (admin_id),
  KEY idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 搜索索引（设计文档 3.3：阶段三执行）
ALTER TABLE posts ADD FULLTEXT INDEX ft_title (title);
