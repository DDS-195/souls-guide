# SoulsGuide 前端

Vue 3 + TypeScript + Vite 客户端。完整启动方式和工程说明见项目根目录的 [`README.md`](../README.md)，HTTP 契约见 [`docs/openapi.json`](../docs/openapi.json)。

```bash
npm ci
npm run dev
npm run type-check
npm run lint
npm run build
```

前端通过 `/api` 和 `/uploads` 访问后端；生产环境由 Nginx 同源反向代理，不在代码中写死公网地址。
