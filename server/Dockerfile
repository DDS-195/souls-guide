# SoulsGuide 后端镜像（D24：Docker Compose 部署，阶段八）
# 参考：设计文档 10.3（FFmpeg 检测式转码）/ 10.7（部署方案）/ 10.8（日志落盘）
# 构建：docker compose up -d --build（由根目录 docker-compose.yml 触发）

FROM node:18-slim

# 10.3 检测式转码：容器内装 FFmpeg，merge 时检测可用即自动转码（本机无需装）
# 国内服务器构建慢：apt 源切阿里云镜像（deb.debian.org 直连国内仅几十 KB/s）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/*.sources 2>/dev/null; \
    apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存（改源码不重装依赖）
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# 复制源码（.dockerignore 排除 node_modules/logs/uploads/.env）
COPY . .

# 非 root 运行：先创建日志/上传目录并归 node 所有
# （命名卷首次挂载会继承此所有权，否则卷以 root 创建、node 无写权限导致 EACCES）
RUN mkdir -p /app/logs /app/uploads && chown -R node:node /app
USER node

EXPOSE 3000

# 健康检查：MySQL 就绪（service_healthy）后 compose 才启动本容器
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "require('http').get({host:'127.0.0.1',port:3000,path:'/api/announcements/latest'},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
