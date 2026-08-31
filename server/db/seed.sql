-- SoulsGuide 预设数据 v2.0（2026-08-07）
-- 权威来源：SoulsGuide-设计文档.md 3.2 / 3.14
-- 幂等设计：INSERT IGNORE 依赖 UNIQUE 约束（users.username / games.name），对已有数据的库重复执行安全
-- 用法：mysql -u root -p souls_guide < seed.sql
-- 强制导入会话 utf8mb4（MySQL 镜像初始化默认 latin1 连接，中文会双倍转码乱码）
SET NAMES utf8mb4;
USE souls_guide;

-- 3.14.1 管理员账号（系统预设）
-- ⚠ 开发密码 admin123（文档外约定，2026-08-07 由后端 AI 生成哈希；生产环境必须改密）
INSERT IGNORE INTO users (username, password, role, apply_status) VALUES
('admin', '$2b$10$ZzwVdFP9qnBluTNG8oRGB.FuE8LVLyMD131oTNrCUSIsfLCsaJEqi', 'admin', 'approved');

-- 3.2 游戏预设数据（7 条）
INSERT IGNORE INTO games (name, description, sort_order) VALUES
('艾尔登法环', 'FromSoftware 2022 年开放世界魂系巨作', 1),
('只狼：影逝二度', '2019 年 TGA 年度游戏，架空的日本战国', 2),
('黑暗之魂3', '魂系列集大成之作', 3),
('黑暗之魂1', '经典重制，传火起源', 4),
('恶魔之魂', 'PS5 重制版，魂系原点', 5),
('血源诅咒', 'PS 独占，克苏鲁风格的维多利亚猎杀', 6),
('仁王2', 'Team Ninja 开发，战国 + 妖怪的诛死游戏', 7);
