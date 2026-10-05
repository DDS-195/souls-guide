#!/usr/bin/env sh
set -eu
umask 077
# 与生产部署使用相同的 Compose 文件和项目名；调用时须处于仓库根目录。
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.prod.yml}"
if [ "${ALLOW_BACKUP_DOWNTIME:-}" != YES ]; then
  echo 'Backup requires a maintenance window: set ALLOW_BACKUP_DOWNTIME=YES' >&2
  exit 3
fi

BACKUP_ROOT="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "BACKUP_RETENTION_DAYS must be a non-negative integer" >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_ROOT"
BACKUP_ROOT_ABS="$(CDPATH= cd -- "$BACKUP_ROOT" && pwd -P)"
if [ "$BACKUP_ROOT_ABS" = "/" ]; then
  echo "Refusing to use filesystem root as BACKUP_ROOT" >&2
  exit 2
fi

TARGET="$BACKUP_ROOT_ABS/$STAMP"
TARGET_TMP="$BACKUP_ROOT_ABS/.$STAMP.tmp"
if [ -e "$TARGET" ] || [ -e "$TARGET_TMP" ]; then
  echo "Backup target already exists: $TARGET" >&2
  exit 2
fi

LOCK="$BACKUP_ROOT_ABS/.backup-lock"
mkdir "$LOCK" || { echo 'Another backup is running (or stale lock requires inspection)' >&2; exit 4; }
mkdir "$TARGET_TMP"
STOPPED=0
cleanup() {
  code=$?
  trap - EXIT
  if [ "$STOPPED" = 1 ]; then docker compose start server nginx || code=1; fi
  rm -rf -- "$TARGET_TMP"
  rmdir "$LOCK"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
# 停止应用写入与后台清理后再复制数据库和文件；不允许外部程序同时写库/卷。
docker compose ps --status running --services | grep -qx server || { echo 'server must be running before backup' >&2; exit 5; }
docker compose ps --status running --services | grep -qx nginx || { echo 'nginx must be running before backup' >&2; exit 5; }
STOPPED=1
docker compose stop nginx server

# 先写未压缩 SQL，使 mysqldump/docker 的失败码不会被管道末端 gzip 掩盖。
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF souls_guide' > "$TARGET_TMP/database.sql"
gzip "$TARGET_TMP/database.sql"
docker compose run --rm --no-deps -T server tar -C /app/uploads -czf - . > "$TARGET_TMP/uploads.tar.gz"
gzip -t "$TARGET_TMP/database.sql.gz"
tar -tzf "$TARGET_TMP/uploads.tar.gz" >/dev/null
# Keep recovery configuration private with the backup (umask 077 above).
cp .env "$TARGET_TMP/environment.env"
cp docker-compose.yml "$TARGET_TMP/docker-compose.yml"
for config in docker-compose.prod.yml docker-compose.prod-http.yml; do
  if [ -f "$config" ]; then cp "$config" "$TARGET_TMP/$config"; fi
done
(cd "$TARGET_TMP" && sha256sum database.sql.gz uploads.tar.gz > SHA256SUMS)
printf '%s\n' "$STAMP" > "$TARGET_TMP/backup-id.txt"
mv "$TARGET_TMP" "$TARGET"
docker compose start server nginx
STOPPED=0
attempt=0
until docker compose exec -T server node -e "require('http').get('http://127.0.0.1:3000/health/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 15 ] || { echo 'Backend did not recover after backup' >&2; exit 6; }
  sleep 2
done
attempt=0
until docker compose exec -T nginx nginx -t; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 5 ] || exit 6
  sleep 2
done

# 仅清理脚本生成的时间戳目录；即使 BACKUP_ROOT 指错，也不会删除普通目录。
find "$BACKUP_ROOT_ABS" -mindepth 1 -maxdepth 1 -type d -name '????????-??????' -mtime "+$RETENTION_DAYS" -exec sh -c '
  for candidate do
    [ ! -L "$candidate" ] || continue
    [ -f "$candidate/SHA256SUMS" ] && [ -f "$candidate/backup-id.txt" ] || continue
    [ "$(cat "$candidate/backup-id.txt")" = "${candidate##*/}" ] || continue
    rm -rf -- "$candidate"
  done
' sh {} +
echo "Backup created: $TARGET"
