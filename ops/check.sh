#!/bin/sh
set -eu
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.prod.yml}"
# 只读检查；失败退出非零，交由服务器调度器/监控平台通知管理员。
docker compose exec -T server node -e '
const fs = require("node:fs/promises");
(async () => {
  const response = await fetch("http://127.0.0.1:3000/health/ready", {signal: AbortSignal.timeout(5000)});
  if (response.status !== 200) throw new Error("API/database not ready");
  const disk = await fs.statfs("/app/uploads");
  const freeMB = Math.floor(disk.bavail * disk.bsize / 1048576);
  if (freeMB < Number(process.env.MIN_UPLOAD_FREE_MB || 2048)) throw new Error("Upload disk below reserve");
  console.log("API/database ready; upload disk above reserve");
})().catch(error => {console.error(error.message); process.exit(1)});
'
