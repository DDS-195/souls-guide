# 部署、迁移与恢复

无域名/证书的受限IP演示请看 [IP-HTTP部署.md](./IP-HTTP部署.md)，使用独立HTTP覆盖配置；以下默认仍为HTTPS正式部署。

## 环境准备

复制 `.env.example` 为 `.env`，至少替换：

- `MYSQL_ROOT_PASSWORD`：仅数据库初始化、健康检查和备份使用。
- `MYSQL_PASSWORD`：应用最小权限用户 `souls_guide_app` 的密码。
- `JWT_SECRET`：生产至少 32 字符随机值。
- `ADMIN_INITIAL_PASSWORD`：首次启动临时提供，12–72 位并包含大小写、数字和特殊字符；创建/替换管理员后从环境中移除。

不要提交 `.env`、私钥或 `nginx/certs/`。

## 本地开发

```bash
mysql -u root -p < server/db/schema.sql
mysql -u root -p < server/db/seed.sql
cd server && npm ci && npm run dev
cd client && npm ci && npm run dev
```

管理员不再由 seed 写固定密码；设置 `ADMIN_INITIAL_PASSWORD` 后首次启动后端即可创建。

## HTTPS Docker 部署

在安装Node24、Docker并填写根目录`.env`、放置证书后，先运行 `node ops/preflight.cjs`。该只读检查使用生产Compose最终配置，核验密钥、数据库账号映射、公开端口、域名、证书有效期（至少7天）及证书私钥匹配；不会启动服务或输出凭证。它不验证CA信任链、DNS、防火墙和旧数据卷中的实际账号密码，不能替代服务器验收。默认检查本项目标准80/443部署，外置代理等其他拓扑需要另行调整。

预检与恢复专项测试：`node --test ops/preflight.test.cjs ops/restore.test.cjs`（需 Linux 和 OpenSSL）本轮17项通过；后端另有263项真实HTTP/MySQL/FFmpeg回归。完整Compose预检仍需在配置真实环境的服务器运行。

将证书放到：

```text
nginx/certs/fullchain.pem
nginx/certs/privkey.pem
```

执行：

```bash
npm ci --prefix client
npm run build --prefix client
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

生产覆盖会启用 80→443、TLS、HSTS 和受限的一跳 `trust proxy`。应用使用独立数据库用户；root 不注入应用容器。

已有旧数据卷首次切换最小权限账号时，MySQL 官方初始化环境变量不会重新创建用户。应先由 DBA 创建/授权 `souls_guide_app` 到 `souls_guide.*`，再切换服务环境。

## Migration

服务在监听端口前执行 `server/db/migrations/`，成功版本写入 `schema_migrations`。新环境先导入 `schema.sql`；已有环境不要重复导入完整 schema，可先运行 `npm run db:migrate --prefix server`，也可由新版本服务启动时执行增量 migration。上线顺序为：备份 → 执行兼容 migration → 启动服务 → 健康检查 → 再清理旧版本。

## 测试隔离

`npm test` 只允许使用名称以 `_test` 结尾的数据库。默认根据 `DB_NAME` 生成 `<name>_test`，每次重建并在结束后销毁。若应用账号无建库权限，设置仅用于 CI/测试的 `TEST_DB_ADMIN_USER`、`TEST_DB_ADMIN_PASSWORD`。

## 备份与恢复

```bash
ALLOW_BACKUP_DOWNTIME=YES sh ./ops/backup.sh ./backups
I_UNDERSTAND_DATA_WILL_BE_OVERWRITTEN=YES ./ops/restore.sh ./backups/<timestamp>
```

备份在显式批准的维护窗口暂停 server/nginx（同时停止应用写入和清理任务），再复制 MySQL 与 uploads；期间不得有其他写库/写卷程序。脚本结束会恢复服务，备份默认保留 14 天。恢复失败则保持停服，避免半恢复数据对外提供。必须先在隔离环境演练。两个脚本默认使用生产 Compose 组合，运行目录必须是仓库根；自定义项目名时保持 COMPOSE_PROJECT_NAME 一致。

## 2026-09-13 生产配置补齐

2026-10-03复核：后端隔离Linux环境263 PASS / 0 FAIL，运行器及容量专项12项通过，Linux预检及恢复专项17项通过；前端9组回归、类型检查、构建及体积预算通过，Lint 0错误/0警告。经授权联网的前后端npm官方审计均为0项已知漏洞（不是无漏洞保证）。恢复专项采用假Docker验证安全流程，不等于真实生产灾备演练；详见《审计修复与发布-2026-10-03》。

- 本地、CI、后端镜像统一 Node 24；本地以 `.nvmrc` 为准，镜像用 npm ci 安装锁定依赖。
- `PUBLIC_ORIGIN=https://实际域名` 与 `SITE_HOST=实际域名` 必须一致，当前模板使用标准 443 端口。Nginx 拒绝其他 Host，定向到固定 HTTPS 域名，静态资源也带安全响应头。
- 生产启动在数据库迁移前拒绝示例/弱密钥、密钥复用、root 数据库账号和跳过媒体检测。需自行设置独立随机 JWT_SECRET、ANALYTICS_SALT（至少32字符）、MYSQL_PASSWORD（至少16字符），应用读取映射后的 DB_PASSWORD。不要将值打印进日志或提交 Git。
- 生产 CORS 限定网站源；应用隐藏框架响应头。仍需实际配置证书自动续期、安全组仅开放80/443和受限SSH。
- 上传最低可用空间默认2048MB，可设 MIN_UPLOAD_FREE_MB（不低于512）；单进程最多6个在途上传/合并请求。空间不足、繁忙或无法检查磁盘均返回503。它是保护阈值，不是用户存储配额或原子磁盘预留，不能保证并发转码绝不耗尽空间。
- `/health/ready` 检查数据库，失败503且不暴露内部错误；仅容器内访问，Nginx不公开它。Docker健康检查不会自动重启仅标记unhealthy的容器，仍需运维告警。
- 生产应用启用 init、禁止新增权限、丢弃Linux capabilities，应用/Nginx Docker日志轮转。原有转码并发1、15分钟超时、非root运行继续保留。
- CI增加生产Nginx镜像构建、临时证书配置检查和备份脚本语法检查；只有实际CI运行成功后才算容器验收通过。

### 尚需部署环境执行

仓库根目录执行 `sh ops/check.sh` 可只读检查 API/数据库与上传磁盘阈值，失败返回非零退出码；需要在服务器调度器中接入通知渠道。它不检查证书到期、公网可达或异机备份，不能替代外部监控。备份前先进入维护窗口，等待上传与转码结束；正常停服最多等待25秒请求排空，超时强制退出不能保证在途操作完成。

安全补丁通过兼容更新锁文件落地；Express 的 qs 子依赖另使用 `^6.16.0` override，后续升级 Express 后应复核能否移除。

证书续期、云安全组、异机备份、备份定时调度和失败告警必须在实际服务器设置，本仓库不能代替它们。正式开放前完成真实视频、低磁盘、重启持久化、备份恢复演练，并审查依赖漏洞。更严格的迁移/运行数据库账号分离与用户上传总量配额仍未实现。

## 当前验证边界

本轮执行环境没有 Docker 和本机 ffmpeg/ffprobe，因此已完成代码、配置、前端构建和随机字节媒体协议测试，但实际容器 TLS 启动与真实 H.265/4K 转码仍须在带 Docker/FFmpeg 的部署机执行验收。
