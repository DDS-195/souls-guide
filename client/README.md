# SoulsGuide — 魂类游戏攻略内容社区

魂类游戏（黑暗之魂 / 艾尔登法环 / 只狼等）攻略分享社区。创作者撰写图文 + 视频攻略，经管理员审核后发布；读者可点赞、收藏、评论、关注作者；完整 RBAC 权限体系（普通用户 / 创作者 / 管理员）。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3.5 · Vite · TypeScript · Pinia · TinyMCE 8 富文本 · ECharts 6 · DOMPurify |
| 后端 | Node.js · Express 4 · MySQL 8（mysql2）· JWT · bcryptjs |
| 特色 | FFmpeg 视频转码 · SparkMD5 分片断点续传 · Canvas 图片压缩 · 双主题设计系统 · 操作日志审计 |

## 目录结构

```
souls-guide/
├── client/          # Vue 3 前端（端口 5173）
├── server/          # Express 后端（端口 3000）
│   ├── db/          # schema.sql + seed.sql（14 张表）
│   ├── src/         # routes / controllers / services / middlewares / utils
│   └── uploads/     # 图片 / 视频存储（运行时生成）
└── SoulsGuide-设计文档.md   # 项目唯一权威设计稿（API 契约 + 表结构 + 协作铁律）
```

## 本地开发

环境要求：Node.js 18+、MySQL 8。

**1. 初始化数据库**

```sql
mysql -u root -p < server/db/schema.sql
mysql -u root -p < server/db/seed.sql   -- 内置 admin 账号（开发密码见 seed.sql 注释）
```

**2. 后端**（`server/.env` 配置 `DB_HOST / DB_USER / DB_PASSWORD / DB_NAME` 等）

```bash
cd server
npm install
npm run dev        # nodemon 热重载，端口 3000
```

**3. 前端**

```bash
cd client
npm install
npm run dev        # Vite 开发服务器，端口 5173，/api 与 /uploads 已代理到后端
```

浏览器访问 http://localhost:5173

## Docker 部署（阶段八，进行中）

本地 Docker Desktop（WSL2）已配置完成，可在本地预演；服务器部署采用三容器 Compose 方案（mysql + server + nginx，Nginx 负责静态资源 / 反代 / 视频 Range）。详见设计文档第 10.7 节与 D24 决策记录。

## 文档

**[SoulsGuide-设计文档.md](../SoulsGuide-设计文档.md)** 是项目唯一权威设计稿：多 AI 协作铁律、14 张表结构、API 契约、技术选型、决策记录（D1–D24）。
