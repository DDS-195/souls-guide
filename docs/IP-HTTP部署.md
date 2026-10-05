# 无域名、无证书的IP HTTP演示部署

这是明确选择明文传输的受限演示方案，不是与HTTPS等价的生产安全方案。登录密码、令牌、内容可能被窃听或篡改；使用独立测试密码、测试数据，安全组尽量限制访问来源。不要开放真实用户注册。后台生产密钥检查、非root账号、磁盘保护、日志轮转仍生效。

## 环境配置

参照根目录`.env.http.example`填写`.env`，替换示例密钥。不要覆盖旧部署的数据库密码、JWT或数据卷。当前服务器示例：

```dotenv
ALLOW_INSECURE_HTTP=true
SITE_HOST=116.62.158.251
PUBLIC_ORIGIN=http://116.62.158.251
HTTP_PORT=80
```

若另选8080端口，HTTP_PORT改为8080，同时PUBLIC_ORIGIN改为`http://116.62.158.251:8080`。但另选端口不能解决容器名称/数据卷冲突，必须先确认既有部署。

## 预检和部署

当前服务器80端口已经占用，另有旧Node进程；先识别旧服务、备份数据并确定升级方案，不能直接重复启动以下命令。

确认可部署后，在仓库根目录（Linux）使用：

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod-http.yml
node ops/preflight.cjs --http
docker compose config --quiet
docker compose up -d --build
sh ops/check.sh
```

前端dist应提前在本地/CI使用Node24构建。不要叠加HTTPS的`docker-compose.prod.yml`，HTTP镜像不读取证书、不监听443、不强制跳HTTPS、不发送HSTS。Node24用于预检脚本；应用本身运行在容器内。

备份、恢复和检查脚本同样需要上述COMPOSE_FILE（并保持相同COMPOSE_PROJECT_NAME）。每次新开SSH会话或配置服务器调度器时都需明确设置，防止误用默认HTTPS组合。脚本的停服授权和恢复保护不变。

## 验证边界

预检只验证配置，不能证明服务器可用。需在服务器执行HTTP镜像启动、首页/通知/发文/审核、真实视频及备份恢复验证。本地无Docker，CI配置检查待远端执行。

前端通知请求编号改用getRandomValues生成UUID，不依赖仅安全上下文可用的randomUUID。剪贴板功能在HTTP中可能不可用，原有失败提示保留。

未来切回HTTPS：恢复HTTPS的PUBLIC_ORIGIN/SITE_HOST和Compose组合，移除ALLOW_INSECURE_HTTP并配置证书；不要删除数据库或上传卷。
