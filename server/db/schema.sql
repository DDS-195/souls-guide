-- SoulsGuide 建表脚本 v3.0（2026-09-01）
-- 新环境初始化基线；已有环境的结构升级统一由 db/migrations 执行。
-- 用法：mysql -u root -p < schema.sql （库名 souls_guide）

-- 强制导入会话 utf8mb4（MySQL 镜像初始化默认 latin1 连接，中文会双倍转码乱码）
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS souls_guide DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE souls_guide;

-- 3.1 users — 用户表
-- ⚠ D14（2026-08-07）：nickname/gender/birthday 三列已认可，与现有库对齐
CREATE TABLE IF NOT EXISTS users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(50) NOT NULL UNIQUE,
  password     VARCHAR(255) NOT NULL,
  avatar       VARCHAR(500) DEFAULT NULL,
  bio          VARCHAR(200) DEFAULT NULL,
  role         ENUM('user', 'creator', 'admin') DEFAULT 'user',
  apply_status ENUM('none', 'pending', 'approved', 'rejected') DEFAULT 'none',
  apply_reason VARCHAR(500) DEFAULT NULL,
  status       TINYINT DEFAULT 1,       -- 1=正常 0=封禁
  token_version INT NOT NULL DEFAULT 0, -- 改密时递增，使历史 JWT 立即失效
  gender       VARCHAR(10) DEFAULT NULL,
  birthday     DATE DEFAULT NULL,
  nickname     VARCHAR(50) DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3.2 games — 游戏表
CREATE TABLE IF NOT EXISTS games (
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
CREATE TABLE IF NOT EXISTS posts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  title          VARCHAR(200) NOT NULL,
  content        LONGTEXT NOT NULL,
  cover          VARCHAR(500) DEFAULT NULL,
  game_id        INT NOT NULL,
  category       VARCHAR(30) NOT NULL,
  status         ENUM('draft', 'pending', 'published', 'rejected') DEFAULT 'draft',
  published_at   DATETIME DEFAULT NULL,  -- 首次审核通过时间；统计发布年龄，不再误用草稿创建时间
  reject_reason  VARCHAR(200) DEFAULT NULL,
  content_version INT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at DATETIME DEFAULT NULL,
  view_count     INT DEFAULT 0,
  like_count     INT DEFAULT 0,
  comment_count  INT DEFAULT 0,
  user_id        INT NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE RESTRICT,
  KEY idx_posts_status_created (status, created_at),
  KEY idx_posts_review_queue (status, submitted_at, id),
  KEY idx_posts_game_status_created (game_id, status, created_at),
  KEY idx_posts_user_status_created (user_id, status, created_at)
);

-- 3.3.1 行为分析事实表：只增不改，不以当前 likes/favorites 等关系表替代历史。
-- 旧数据无法可靠回放；精确趋势从 003_analytics_metrics 迁移上线日开始记录。
CREATE TABLE IF NOT EXISTS analytics_events (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type   ENUM('view','like','unlike','favorite','unfavorite','comment','comment_delete','follow','unfollow') NOT NULL,
  post_id      INT DEFAULT NULL,
  author_id    INT NOT NULL,
  actor_id     INT DEFAULT NULL,
  visitor_key  CHAR(64) DEFAULT NULL,
  event_value  INT UNSIGNED NOT NULL DEFAULT 1,
  is_internal  TINYINT(1) NOT NULL DEFAULT 0,
  occurred_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_analytics_author_time (author_id, occurred_at),
  KEY idx_analytics_post_time (post_id, occurred_at),
  KEY idx_analytics_type_time (event_type, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 同一套字段分别保存 post / creator 粒度的每日聚合；事实表仍是可复算来源。
CREATE TABLE IF NOT EXISTS analytics_daily_metrics (
  scope_type         ENUM('post','creator') NOT NULL,
  scope_id           INT NOT NULL,
  metric_date        DATE NOT NULL,
  pv                 INT UNSIGNED NOT NULL DEFAULT 0,
  uv                 INT UNSIGNED NOT NULL DEFAULT 0,
  likes_added        INT UNSIGNED NOT NULL DEFAULT 0,
  likes_removed      INT UNSIGNED NOT NULL DEFAULT 0,
  favorites_added    INT UNSIGNED NOT NULL DEFAULT 0,
  favorites_removed  INT UNSIGNED NOT NULL DEFAULT 0,
  comments_added     INT UNSIGNED NOT NULL DEFAULT 0,
  comments_removed   INT UNSIGNED NOT NULL DEFAULT 0,
  followers_added    INT UNSIGNED NOT NULL DEFAULT 0,
  followers_removed  INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_type, scope_id, metric_date),
  KEY idx_analytics_daily_date (metric_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- UV 的幂等集合：同一访客在同一天、同一文章/创作者范围内只贡献一次 UV。
CREATE TABLE IF NOT EXISTS analytics_daily_visitors (
  scope_type   ENUM('post','creator') NOT NULL,
  scope_id     INT NOT NULL,
  metric_date  DATE NOT NULL,
  visitor_key  CHAR(64) NOT NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_type, scope_id, metric_date, visitor_key),
  KEY idx_analytics_visitor_date (visitor_key, metric_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 阅读上报短时防重状态；原始 visitor id 不落库，只保存服务端哈希。
CREATE TABLE IF NOT EXISTS analytics_view_sessions (
  post_id         INT NOT NULL,
  visitor_key     CHAR(64) NOT NULL,
  last_counted_at DATETIME NOT NULL,
  PRIMARY KEY (post_id, visitor_key),
  KEY idx_analytics_view_last (last_counted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3.4 tags — 标签表
CREATE TABLE IF NOT EXISTS tags (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(30) NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.5 post_tags — 文章-标签关联表
CREATE TABLE IF NOT EXISTS post_tags (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  tag_id  INT NOT NULL,
  UNIQUE KEY uk_post_tag (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 3.6 notifications — 通知表
CREATE TABLE IF NOT EXISTS notifications (
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
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY idx_notifications_receiver_read_created (receiver_id, is_read, created_at)
);

-- 3.7 reports — 举报表
CREATE TABLE IF NOT EXISTS reports (
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
CREATE TABLE IF NOT EXISTS media (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  post_id    INT NOT NULL,
  url        VARCHAR(500) NOT NULL,
  type       ENUM('image', 'video') NOT NULL,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 3.9 comments — 评论表
CREATE TABLE IF NOT EXISTS comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  content    TEXT NOT NULL,
  user_id    INT NOT NULL,
  post_id    INT NOT NULL,
  parent_id  INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
  KEY idx_comments_post_created (post_id, created_at)
);

-- 3.10 likes — 点赞表
CREATE TABLE IF NOT EXISTS likes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  post_id    INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_post (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 3.11 favorites — 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  post_id    INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_post (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  KEY idx_favorites_user_created (user_id, created_at)
);

-- 3.12 follows — 关注表
CREATE TABLE IF NOT EXISTS follows (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  follower_id   INT NOT NULL,
  following_id  INT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_follow (follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_follows_following_created (following_id, created_at)
);

-- 3.13 announcements — 系统公告表
CREATE TABLE IF NOT EXISTS announcements (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  content    TEXT NOT NULL,
  author_id  INT NOT NULL,
  status     ENUM('draft', 'published', 'archived', 'deleted') NOT NULL DEFAULT 'draft',
  version    INT UNSIGNED NOT NULL DEFAULT 1,
  source_id  INT DEFAULT NULL,
  published_at DATETIME DEFAULT NULL,
  archived_at  DATETIME DEFAULT NULL,
  deleted_at   DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT,
  KEY idx_announcements_status_created (status, deleted_at, created_at),
  KEY idx_announcements_published (published_at, id),
  KEY idx_announcements_source (source_id)
);

-- 固定发布槽：所有发布操作先锁 global 行，避免并发发布时出现双生效或交叉死锁。
CREATE TABLE IF NOT EXISTS announcement_channels (
  channel VARCHAR(32) PRIMARY KEY,
  current_announcement_id INT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (current_announcement_id) REFERENCES announcements(id) ON DELETE SET NULL
);
INSERT IGNORE INTO announcement_channels (channel, current_announcement_id) VALUES ('global', NULL);

-- 公告领域历史与 HTTP 操作日志分离；快照和公告状态写入同一事务，可用于追溯与恢复。
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
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INT NOT NULL,
  user_id INT NOT NULL,
  version INT UNSIGNED NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (announcement_id, user_id, version),
  KEY idx_announcement_reads_user (user_id, read_at),
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3.14 operation_logs — 操作日志表（2026-08-09 D23，R4 唯一例外，用户批准）
-- 审计日志：无外键（用户删除后记录保留，admin_username 快照）；只增不改；写操作中间件自动记录
CREATE TABLE IF NOT EXISTS operation_logs (
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

-- 3.15 upload_assets — 上传资产所有权表
-- 上传成功先登记 temporary；绑定文章后转 attached。物理文件删除必须以引用关系为准，禁止按任意 URL 直接删除。
CREATE TABLE IF NOT EXISTS upload_assets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  owner_id   INT NOT NULL,
  url        VARCHAR(500) NOT NULL,
  hash       CHAR(32) DEFAULT NULL,
  type       ENUM('image', 'video') NOT NULL,
  status     ENUM('temporary', 'attached', 'deleted') NOT NULL DEFAULT 'temporary',
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_asset_owner_url (owner_id, url),
  KEY idx_asset_url_status (url, status),
  KEY idx_asset_expiry (status, expires_at),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3.16 post_assets — 文章与上传资产引用关系
CREATE TABLE IF NOT EXISTS post_assets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  post_id    INT NOT NULL,
  asset_id   INT NOT NULL,
  usage_type ENUM('cover', 'content', 'video') NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_post_asset_usage (post_id, asset_id, usage_type),
  KEY idx_post_asset_asset (asset_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES upload_assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3.17 schema_migrations — 已执行迁移版本
CREATE TABLE IF NOT EXISTS post_revisions (
  post_id INT PRIMARY KEY,
  content_version INT UNSIGNED NOT NULL,
  status ENUM('pending','rejected') NOT NULL DEFAULT 'pending',
  payload JSON NOT NULL,
  reject_reason VARCHAR(200) DEFAULT NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_revision_queue (status, submitted_at, post_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS post_revision_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  asset_id INT NOT NULL,
  usage_type ENUM('cover','content','video') NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_revision_asset_usage (post_id,asset_id,usage_type),
  KEY idx_revision_asset (asset_id),
  FOREIGN KEY (post_id) REFERENCES post_revisions(post_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES upload_assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(100) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 中文搜索当前明确采用小数据量 LIKE；不保留未被查询使用且无 ngram 分词保证的 FULLTEXT 索引。

CREATE TABLE IF NOT EXISTS post_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  content_version INT UNSIGNED NOT NULL,
  reviewer_id INT NOT NULL,
  reviewer_username VARCHAR(50) NOT NULL,
  decision ENUM('published','rejected') NOT NULL,
  reason VARCHAR(200) DEFAULT NULL,
  snapshot JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_post_review_version (post_id, content_version),
  KEY idx_post_reviews_post (post_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
