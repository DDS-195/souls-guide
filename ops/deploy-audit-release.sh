#!/bin/sh
# Scoped upgrade: preserve credentials and all data volumes, keep rollback images.
set -eu
umask 077
RELEASE=sg-20261003-audit-r1
STAGE=/opt/soulsguide-release-20261003-audit-r1
ACTIVE=/opt/soulsguide
PREVIOUS=/opt/soulsguide-previous-20261003-audit-r1
case "$(readlink -f "$ACTIVE")" in /opt/soulsguide) ;; *) echo 'Unexpected active directory' >&2; exit 2 ;; esac
[ -d "$STAGE/server/src" ] && [ -f "$STAGE/client/dist/release.json" ] || exit 2
[ ! -e "$PREVIOUS" ] || { echo 'Previous snapshot already exists' >&2; exit 2; }
export COMPOSE_PROJECT_NAME=soulsguide
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod-http.yml
cp "$ACTIVE/.env" "$STAGE/.env"
chmod 600 "$STAGE/.env"
# Preserve fingerprinted assets needed by tabs opened before the upgrade.
if [ -d "$ACTIVE/client/dist/assets" ]; then
  for source in "$ACTIVE"/client/dist/assets/*; do
    [ -f "$source" ] || continue
    name=${source##*/}
    case "$name" in *-*.js|*-*.css|*.woff2)
      [ -e "$STAGE/client/dist/assets/$name" ] || cp "$source" "$STAGE/client/dist/assets/$name" ;;
    esac
  done
fi
docker image tag "$(docker inspect sg-server --format '{{.Image}}')" "soulsguide-server:rollback-$RELEASE"
docker image tag "$(docker inspect sg-nginx --format '{{.Image}}')" "soulsguide-nginx:rollback-$RELEASE"
cd "$STAGE"
docker compose config --quiet
# Host Node can be older; validate private Compose JSON with the production
# image's Node 24, without a Docker socket or publishing test ports.
docker compose config --format json | docker run --rm -i --init --memory=128m --cpus=1 \
  -v "$STAGE/ops:/check/ops:ro" -v "$STAGE/server/src:/check/server/src:ro" \
  --entrypoint node "soulsguide-server:rollback-$RELEASE" -e \
  "let data='';process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>{require('/check/ops/preflight.cjs').validateCompose(JSON.parse(data));console.log('PRODUCTION_PREFLIGHT_OK')})"
fingerprint='const p=require(process.argv[1]);const entries=Object.entries(p.packages).filter(([k,v])=>k&&!v.dev).map(([k,v])=>[k,v.version,v.integrity]).sort();console.log(require("crypto").createHash("sha256").update(JSON.stringify(entries)).digest("hex"))'
expected=$(docker run --rm --memory=128m -v "$STAGE/server/package-lock.json:/candidate-lock.json:ro" --entrypoint node "soulsguide-server:rollback-$RELEASE" -e "$fingerprint" /candidate-lock.json)
installed=$(docker exec sg-server node -e "$fingerprint" /app/package-lock.json)
if [ "$expected" = "$installed" ] && [ -n "$expected" ]; then
  echo "Production dependency fingerprint unchanged: $expected"
  docker build --build-arg "BASE_IMAGE=soulsguide-server:rollback-$RELEASE" -f server/Release.Dockerfile -t soulsguide-server .
else
  docker compose build server
fi
docker compose build nginx
# Reuse the existing verified backup workflow before any source/container swap.
cd "$ACTIVE"
ALLOW_BACKUP_DOWNTIME=YES BACKUP_RETENTION_DAYS=14 sh ops/backup.sh /opt/soulsguide-backups
swapped=0
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$swapped" = 1 ] && [ "$complete" = 0 ]; then
    echo 'Upgrade failed; restoring source and retained application images' >&2
    docker image tag "soulsguide-server:rollback-$RELEASE" soulsguide-server
    docker image tag "soulsguide-nginx:rollback-$RELEASE" soulsguide-nginx
    mv "$ACTIVE" "$STAGE"
    mv "$PREVIOUS" "$ACTIVE"
    cd "$ACTIVE"
    docker compose up -d --no-deps --no-build server nginx || status=1
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' HUP INT TERM
# Previously fingerprinted assets were retained in the new image before building.
mv "$ACTIVE" "$PREVIOUS"
mv "$STAGE" "$ACTIVE"
swapped=1
cd "$ACTIVE"
docker compose up -d --no-deps --no-build server nginx
attempt=0
until docker compose exec -T server node -e "require('http').get('http://127.0.0.1:3000/health/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"; do
  attempt=$((attempt+1)); [ "$attempt" -lt 30 ] || exit 6; sleep 2
done
docker compose exec -T nginx nginx -t
curl -fsS -H 'Host: 116.62.158.251' http://127.0.0.1/api/games >/dev/null
curl -fsS -H 'Host: 116.62.158.251' http://127.0.0.1/api/posts >/dev/null
curl -fsS -H 'Host: 116.62.158.251' http://127.0.0.1/release.json | grep -q "$RELEASE"
complete=1
printf 'DEPLOY_OK=%s\n' "$RELEASE"
docker compose ps
