#!/usr/bin/env sh
set -eu
umask 077
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.prod.yml}"

SOURCE="${1:-}"
if [ -z "$SOURCE" ] || [ ! -f "$SOURCE/database.sql.gz" ] || [ ! -f "$SOURCE/uploads.tar.gz" ]; then
  echo "Usage: I_UNDERSTAND_DATA_WILL_BE_OVERWRITTEN=YES ./ops/restore.sh <backup-directory>" >&2
  exit 2
fi
if [ "${I_UNDERSTAND_DATA_WILL_BE_OVERWRITTEN:-}" != "YES" ]; then
  echo "Restore refused: set I_UNDERSTAND_DATA_WILL_BE_OVERWRITTEN=YES" >&2
  exit 3
fi

# 只接受 backup.sh 产生的完整备份，不允许 SQL 与媒体包来自不同批次。
SOURCE="$(CDPATH= cd -- "$SOURCE" && pwd -P)"
BACKUP_ID="${SOURCE##*/}"
printf '%s' "$BACKUP_ID" | grep -Eq '^[0-9]{8}-[0-9]{6}$' || { echo 'Invalid backup directory id' >&2; exit 4; }
[ -f "$SOURCE/backup-id.txt" ] && [ ! -L "$SOURCE/backup-id.txt" ] || { echo 'Missing backup-id.txt' >&2; exit 4; }
[ "$(cat "$SOURCE/backup-id.txt")" = "$BACKUP_ID" ] || { echo 'Backup id does not match directory' >&2; exit 4; }
[ -f "$SOURCE/SHA256SUMS" ] && [ ! -L "$SOURCE/SHA256SUMS" ] || { echo 'Missing SHA256SUMS' >&2; exit 4; }
for file in database.sql.gz uploads.tar.gz; do
  [ ! -L "$SOURCE/$file" ] || { echo 'Backup payload must not be a symlink' >&2; exit 4; }
done
# 不让清单引用任意路径；仅允许两个固定文件，各出现一次。
awk '
  NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-fA-F]/ {bad=1}
  $2 == "database.sql.gz" {sql++; next}
  $2 == "uploads.tar.gz" {uploads++; next}
  {bad=1}
  END {exit bad || sql != 1 || uploads != 1 || NR != 2}
' "$SOURCE/SHA256SUMS" || { echo 'Invalid backup checksum manifest' >&2; exit 4; }
(cd "$SOURCE" && sha256sum -c SHA256SUMS)

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sg-restore.XXXXXXXX")"
MUTATING=0
cleanup() {
  code=$?
  trap - EXIT HUP INT TERM
  if [ "$code" -ne 0 ] && [ "$MUTATING" = 1 ]; then
    # start 之后的 readiness 失败同样停服，不能暴露半恢复状态。
    if docker compose stop server nginx; then
      echo 'Restore failed: services remain stopped; inspect before restarting.' >&2
    else
      echo 'Restore failed and services could not be stopped; urgently inspect Docker.' >&2
    fi
  fi
  rm -rf -- "$WORK"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

# 在停止服务和覆盖数据前完成解压/路径/类型检查。
gzip -t "$SOURCE/database.sql.gz"
gzip -t "$SOURCE/uploads.tar.gz"
tar -tzf "$SOURCE/uploads.tar.gz" > "$WORK/uploads-list.txt"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$WORK/uploads-list.txt"; then
  echo "Restore refused: uploads archive contains an unsafe path" >&2
  exit 4
fi
tar -tvzf "$SOURCE/uploads.tar.gz" > "$WORK/uploads-details.txt"
awk '$1 !~ /^[-d]/ {bad=1} END {exit bad}' "$WORK/uploads-details.txt" || {
  echo 'Restore refused: uploads archive contains links or special files' >&2; exit 4;
}
# 不用 gzip | mysql：POSIX sh 没有 pipefail，解压失败不能被 mysql 成功码掩盖。
gzip -dc "$SOURCE/database.sql.gz" > "$WORK/database.sql"

MUTATING=1
docker compose stop server nginx
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot souls_guide' < "$WORK/database.sql"
docker compose run --rm --no-deps -T server sh -c 'find /app/uploads -mindepth 1 -delete'
docker compose run --rm --no-deps -T server tar -C /app/uploads -xzf - < "$SOURCE/uploads.tar.gz"
docker compose start server
attempt=0
until docker compose exec -T server node -e 'fetch("http://127.0.0.1:3000/health/ready",{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))'; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 15 ] || { echo 'Restored backend did not become ready' >&2; exit 6; }
  sleep 2
done
docker compose start nginx
docker compose exec -T nginx nginx -t
# 验证真实反代与数据库读取，而不只是容器 running。
attempt=0
until docker compose exec -T server node -e 'fetch(new URL("/api/games",process.env.PUBLIC_ORIGIN),{signal:AbortSignal.timeout(5000)}).then(async r=>{if(r.status!==200||(await r.json()).code!==0)throw Error("API unavailable")}).catch(()=>process.exit(1))'; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 5 ] || { echo 'Restored public API did not become ready' >&2; exit 6; }
  sleep 2
done
echo "Restore completed from: $SOURCE"
