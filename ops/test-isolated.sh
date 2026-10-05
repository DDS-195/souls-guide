#!/bin/sh
# Run the staged source against a disposable database and container, no host ports.
set -eu
umask 077
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
case "$ROOT" in /opt/soulsguide-audit-*) ;; *) echo 'Expected an isolated audit staging directory' >&2; exit 2 ;; esac
NAME=sg-audit-regression
if docker container inspect "$NAME" >/dev/null 2>&1; then echo 'Audit container already exists; inspect before retrying' >&2; exit 2; fi
ENV_FILE="$ROOT/.test-env"
cleanup() { rm -f "$ENV_FILE"; }
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
docker exec sg-mysql sh -c 'printf "DB_PASSWORD=%s\n" "$MYSQL_ROOT_PASSWORD"' > "$ENV_FILE"
printf 'DB_HOST=mysql\nDB_USER=root\nDB_NAME=souls_guide\nTEST_DB_NAME=sg_audit_%s_test\nNODE_ENV=test\nTZ=Asia/Shanghai\nJWT_SECRET=%s\n' "$(date +%s)" "$(openssl rand -hex 32)" >> "$ENV_FILE"
IMAGE=$(docker inspect sg-server --format '{{.Image}}')
docker run --rm --name "$NAME" --init --memory=320m --cpus=1 --network soulsguide_default \
  --env-file "$ENV_FILE" --tmpfs /app/uploads:rw,uid=1000,gid=1000,size=128m \
  -v "$ROOT/server/src:/app/src:ro" -v "$ROOT/server/db:/app/db:ro" \
  -v "$ROOT/server/test:/app/test:ro" -v "$ROOT/server/server.js:/app/server.js:ro" \
  --entrypoint node "$IMAGE" test/run-all.js
# Operations tests use fake Docker and temp fixtures only, never the real daemon.
docker run --rm --init --memory=192m --cpus=1 -e OPENSSL_CONF=/etc/ssl/openssl.cnf \
  -v "$ROOT/ops:/app/ops:ro" -v /usr/bin/openssl:/usr/bin/openssl:ro \
  -v "$ROOT/server/src:/app/server/src:ro" \
  -v /etc/ssl/openssl.cnf:/etc/ssl/openssl.cnf:ro \
  --entrypoint node "$IMAGE" --test ops/preflight.test.cjs ops/restore.test.cjs
