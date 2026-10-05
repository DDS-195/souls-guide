#!/bin/sh
set -eu
printf '%s' "${SITE_HOST:-}" | grep -Eq '^[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*$' || { echo 'Invalid SITE_HOST' >&2; exit 1; }
# 只替换站点变量，保留 Nginx 的 $host/$request_uri 等运行时变量。
envsubst '${SITE_HOST}' < /etc/nginx/nginx.prod.template > /etc/nginx/nginx.conf
