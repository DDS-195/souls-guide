#!/bin/sh
set -eu
umask 077
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
case "$ROOT" in /opt/soulsguide-audit-video-badge-20261004) ;; *) exit 2 ;; esac
NAME=sg-video-badge-recheck
if docker container inspect "$NAME" >/dev/null 2>&1; then echo 'Recheck container already exists' >&2; exit 2; fi
ENV_FILE="$ROOT/.recheck-env"
cleanup() { rm -f "$ENV_FILE"; }
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
docker exec sg-mysql sh -c 'printf "DB_PASSWORD=%s\n" "$MYSQL_ROOT_PASSWORD"' > "$ENV_FILE"
printf 'DB_HOST=mysql\nDB_USER=root\nDB_NAME=souls_guide\nTEST_DB_NAME=sg_badge_%s_test\nNODE_ENV=test\nTZ=Asia/Shanghai\nJWT_SECRET=%s\n' "$(date +%s)" "$(openssl rand -hex 32)" >> "$ENV_FILE"
IMAGE=$(docker inspect sg-server --format '{{.Image}}')
docker run --rm --name "$NAME" --init --memory=320m --cpus=1 --network soulsguide_default \
  --env-file "$ENV_FILE" --tmpfs /app/uploads:rw,uid=1000,gid=1000,size=128m \
  -v "$ROOT/server/src:/app/src:ro" -v "$ROOT/server/db:/app/db:ro" \
  -v "$ROOT/server/test:/app/test:ro" -v "$ROOT/server/server.js:/app/server.js:ro" \
  -v "$ROOT/ops/video-badge-recheck.cjs:/app/ops/video-badge-recheck.cjs:ro" \
  --entrypoint node "$IMAGE" ops/video-badge-recheck.cjs
