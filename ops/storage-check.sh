#!/bin/sh
# Read-only capacity checks. Warnings are recorded in the systemd journal.
set -eu
export LC_ALL=C
DISK_PATH=${DISK_PATH:-/opt/soulsguide}
DISK_USED_WARN=${DISK_USED_WARN:-85}
DISK_FREE_KB_WARN=${DISK_FREE_KB_WARN:-2097152}
TABLE_BYTES_WARN=${TABLE_BYTES_WARN:-1073741824}
TABLE_ROWS_WARN=${TABLE_ROWS_WARN:-1000000}
DB_BYTES_WARN=${DB_BYTES_WARN:-2147483648}
for value in "$DISK_USED_WARN" "$DISK_FREE_KB_WARN" "$TABLE_BYTES_WARN" "$TABLE_ROWS_WARN" "$DB_BYTES_WARN"; do
  case "$value" in ''|*[!0-9]*) echo 'Invalid capacity threshold' >&2; exit 2 ;; esac
done
failed=0
disk=$(df -Pk "$DISK_PATH")
printf '%s\n' "$disk"
if ! printf '%s\n' "$disk" | awk -v used="$DISK_USED_WARN" -v free="$DISK_FREE_KB_WARN" 'NR==2 {gsub(/%/, "", $5); if ($5>=used || $4<free) exit 1}'; then
  echo 'WARNING: filesystem capacity threshold exceeded' >&2
  failed=1
fi
# Metadata estimates only: no full-table scan, no mutation, no credentials in output.
metrics=$(docker exec sg-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -NBe "SELECT TABLE_NAME, COALESCE(TABLE_ROWS,0), COALESCE(DATA_LENGTH,0)+COALESCE(INDEX_LENGTH,0) FROM information_schema.TABLES WHERE TABLE_SCHEMA=\"souls_guide\""')
[ -n "$metrics" ] || { echo 'No database capacity metadata returned' >&2; exit 2; }
if ! printf '%s\n' "$metrics" | awk -v bytes="$TABLE_BYTES_WARN" -v rows="$TABLE_ROWS_WARN" -v db="$DB_BYTES_WARN" '
  {total+=$3}
  $1=="analytics_events" || $1=="operation_logs" || $1=="notifications" || $1=="analytics_daily_visitors" || $1=="analytics_view_sessions" {
    printf "%s estimated_rows=%s bytes=%s\n", $1,$2,$3
    if ($2>=rows || $3>=bytes) {print "WARNING: table capacity threshold exceeded: " $1; failed=1}
  }
  END {printf "database_bytes=%.0f\n", total; if (total>=db) {print "WARNING: database capacity threshold exceeded"; failed=1}; exit failed}
'; then failed=1; fi
[ "$failed" -eq 0 ] || exit 1
echo 'CAPACITY_OK'
