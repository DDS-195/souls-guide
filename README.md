# SoulsGuide — 魂类游戏攻略社区

SoulsGuide 是一个 Vue 3 + Express + MySQL 的图文/视频攻略平台，覆盖创作、审核、发布、互动、通知和管理审计。项目定位是经过多轮工程加固的学习型 MVP，不宣称多机高可用或零停机发布。

## 已实现的工程能力

- 后端 RBAC、资源所有权校验和文章审核状态机。
- MySQL 事务与统一锁顺序，覆盖互动计数和复合业务写入。
- 上传资产所有权/引用模型、孤儿资源回收、图片魔数校验。
- 5MB 视频分片、断点续传、服务端 MD5、ffprobe 检测和受限并发转码。
- TinyMCE 桌面端按需加载、移动端轻量编辑、ECharts 按需注册、图片压缩、DOMPurify 富文本消毒和双主题响应式 UI。
- HTTPS 生产配置、最小权限数据库用户、请求关联 ID、审计与轮转日志。
- OpenAPI 路由契约、独立测试数据库和 263 项后端回归（真实 HTTP/MySQL/FFmpeg 与故障边界测试）。

## 目录

```text
client/                 Vue 3 + TypeScript 前端
server/                 Express API、migration、测试与上传目录
nginx/                  本地/生产 Nginx 配置
docs/                   仓库内权威文档与 OpenAPI
ops/                    备份和恢复脚本
docker-compose.yml      基础三容器编排
docker-compose.prod.yml HTTPS 生产覆盖
```

数据库当前包含 17 张表；升级通过 `server/db/migrations/` 和 `schema_migrations` 管理。

## 本地开发

要求 Node.js 24 和 MySQL 8；开发热重载使用 `node --watch`，无需 nodemon。

```bash
mysql -u root -p < server/db/schema.sql
mysql -u root -p < server/db/seed.sql

cp server/.env.example server/.env
cd server && npm ci && npm run dev

cd ../client && npm ci && npm run dev
```

seed 只写入 7 个游戏，不包含公开管理员密码。首次创建管理员时，在后端环境中临时设置满足强度要求的 `ADMIN_INITIAL_PASSWORD`；创建成功后移除该变量。

## 验证

```bash
npm run type-check --prefix client
npm run lint --prefix client
npm run build --prefix client
npm test --prefix server
```

后端测试会重建并销毁以 `_test` 结尾的独立数据库，不应对开发库或生产库运行逐条清理。

## Docker HTTPS 部署

复制 `.env.example` 为 `.env` 并替换全部 `CHANGE_ME`，将证书放入 `nginx/certs/`：

```bash
npm ci --prefix client && npm run build --prefix client
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

详细的最小权限账号、旧数据卷升级、迁移、备份和恢复步骤见 [`docs/deployment.md`](./docs/deployment.md)。

## 文档与契约

- [文档索引](./docs/README.md)
- [架构与工程边界](./docs/architecture.md)
- [部署、迁移与恢复](./docs/deployment.md)
- [第二次排障整改结果](./docs/remediation-2026-09-02.md)
- [OpenAPI 3.1](./docs/openapi.json)

历史公网 Demo 使用过明文 HTTP，本 README 不再提供该入口；只有完成 HTTPS、强密码和部署验收后才应重新公开。
