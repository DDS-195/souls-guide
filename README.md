# 🔥 SoulsGuide — 魂类游戏攻略社区

> 面向魂类游戏玩家（艾尔登法环 / 只狼 / 黑魂等）的图文+视频攻略内容平台，覆盖「创作 → 审核 → 互动」完整业务闭环。

**在线 Demo**：[http://116.62.158.251](http://116.62.158.251)

---

## ✨ 项目亮点

- **三层 RBAC 权限体系**：路由守卫 — 动态导航 — 接口鉴权三层防护，内容审核状态机（草稿→待审→发布/驳回）状态流转唯一入口，防越权发布、管理员降级与封禁绕过
- **并发一致性实战**：并发写入基于 MySQL 事务 + 统一锁顺序（FOR UPDATE），点赞/收藏/关注多用户并发下数据强一致；实测定位并根治 MySQL 死锁（ER_LOCK_DEADLOCK，外键共享锁与排他锁环形等待）
- **视频分片断点续传**：SparkMD5 文件指纹 + 5MB 切片 3 并发 + 幂等补传，断网仅补缺失分片，支持最高 500MB 视频；服务端 FFmpeg 检测式转码（H.264/≤1080p，无 FFmpeg 环境自动降级）
- **富文本编辑体验**：TinyMCE 8 深度定制——Canvas 压缩图片转 WebP（15MB 原图实测压至 17KB）、DOMPurify 消毒防 XSS、暗/亮主题自动跟随；全站 CSS 变量双主题设计系统，桌面/移动双端响应式
- **操作审计体系**：中间件零侵入自动记录 17 类管理操作（无外键快照设计，用户删除后审计保留），三级日志（操作审计/访问/错误堆栈）
- **工程质量**：147 项零依赖自动化测试（含真实并发用例）全通过；Docker Compose 三容器部署（MySQL/Node/Nginx，内存隔离 + 健康检查链）

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 · TypeScript · Vite · Pinia · Vue Router · TinyMCE 8 · ECharts 6 · DOMPurify · SparkMD5 |
| 后端 | Node.js · Express 4 · MySQL 8 · JWT · bcrypt · Multer |
| 工程 | Docker Compose · Nginx · FFmpeg · ESLint · Prettier · 零依赖测试体系 |

## 🗂 项目结构

```
souls-guide/
├── client/          # Vue 3 前端（端口 5173，/api 与 /uploads 代理到后端）
│   ├── src/         # api / components / composables / router / stores / types / utils / views
│   └── public/      # favicon + TinyMCE 中文语言包
├── server/          # Express 后端（端口 3000）
│   ├── db/          # schema.sql（14 张表）+ seed.sql（admin + 7 游戏）
│   ├── src/         # routes / controllers / services / middlewares / utils
│   └── test/        # 8 套件 147 项测试（含并发用例），零依赖 runner
├── nginx/           # 前端静态 + 反代 /api + uploads 直出（Range 视频拖动）
└── docker-compose.yml  # 三容器：mysql + server + nginx
```

## 🚀 本地运行

环境要求：Node.js 18+、MySQL 8。

```bash
# 1. 初始化数据库
mysql -u root -p < server/db/schema.sql
mysql -u root -p < server/db/seed.sql     # 内置 admin（admin / admin123）

# 2. 后端（server/.env 配置 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/JWT_SECRET）
cd server && npm install && npm run dev   # 端口 3000

# 3. 前端
cd client && npm install && npm run dev   # 端口 5173
```

浏览器访问 http://localhost:5173

## 🐳 Docker 部署（生产）

```bash
cd client && npm run build                # 构建前端产物（nginx 镜像 COPY）
cd ..
docker compose up -d --build              # mysql + server + nginx 三容器
```

- MySQL 首启自动初始化 schema + seed（幂等）
- FFmpeg 随 server 镜像内置，检测式转码自动启用
- 上传文件与数据库均卷持久化，容器重建不丢数据

## 🧪 测试

```bash
cd server && node test/run-all.js
# 8 个套件 147 项：用户/游戏/文章/互动/管理/媒体/安全/并发（零外部依赖）
```

## 📖 文档

- 设计文档（API 契约 + 14 表结构 + 决策记录）
- 并发与高可用评估文档（方案 / 问题 / 整改路线图）
- 死锁问题分析与解决文档（复现 → 根因 → 根治全记录）
- 视频上传问题修复文档（三重缺陷排查档案）

> 项目为个人全栈学习实践（多 AI 协作开发：契约文档管理模块边界与前后端接口对齐）。
