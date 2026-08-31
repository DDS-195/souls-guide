# SoulsGuide 前端 + 反代镜像（D24，阶段八）
# 前端 dist 在本地构建（需 Node 环境），COPY 进镜像——服务器无需安装 Node
# 职责：serve dist + 反代 /api → server:3000 + 直出 /uploads（Range 视频播放）

FROM nginx:alpine

COPY client/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf
# scp 从 Windows 上传的 dist 目录权限为 700（仅 root 可进），
# 而 nginx worker 是普通用户 → 静态资源 403。构建时统一修正为可读可遍历。
RUN chmod -R o+rX /usr/share/nginx/html
