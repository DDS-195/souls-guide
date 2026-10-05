#!/bin/sh
# Small, reversible service/thumbnail patch. No schema change or database content writes.
set -eu
umask 077
RELEASE=sg-20261004-video-badge-r1
STAGE=/opt/soulsguide-video-badge-20261004-r1
BACKUP=/opt/soulsguide-video-badge-backup-20261004-r1
ACTIVE=/opt/soulsguide
case "$(readlink -f "$ACTIVE")" in /opt/soulsguide) ;; *) exit 2 ;; esac
[ -s "$STAGE/client/dist/release.json" ] && [ -s "$STAGE/release-files.sha256" ] || exit 2
[ ! -e "$BACKUP" ] || { echo 'Backup target already exists' >&2; exit 2; }
cd "$STAGE"
sha256sum -c release-files.sha256 >/dev/null
grep -q "$RELEASE" client/dist/release.json
export COMPOSE_PROJECT_NAME=soulsguide
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod-http.yml
OLD_SERVER=$(docker inspect sg-server --format '{{.Image}}')
OLD_NGINX=$(docker inspect sg-nginx --format '{{.Image}}')
docker image tag "$OLD_SERVER" "soulsguide-server:rollback-$RELEASE"
docker image tag "$OLD_NGINX" "soulsguide-nginx:rollback-$RELEASE"
docker build --pull=false --build-arg "BASE_IMAGE=soulsguide-server:rollback-$RELEASE" \
  -f server/VideoBadge.Dockerfile -t "soulsguide-server:$RELEASE" .
docker build --pull=false --build-arg "BASE_IMAGE=soulsguide-nginx:rollback-$RELEASE" \
  -f client/VideoBadge.Dockerfile -t "soulsguide-nginx:$RELEASE" .
docker run --rm -e SITE_HOST=116.62.158.251 --network soulsguide_default \
  --entrypoint sh "soulsguide-nginx:$RELEASE" -c '/docker-entrypoint.d/19-site-config.sh && nginx -t'
mkdir "$BACKUP"
cp -a "$ACTIVE/client/dist" "$BACKUP/dist"
FILES='client/src/components/PostCard.vue client/src/types/api.ts client/src/views/Home.vue client/src/views/MyLists.vue client/src/views/Search.vue client/src/views/UserProfile.vue client/package.json client/checks/home-pagination.test.mjs server/src/services/postService.js server/test/17-home-feed.suite.js server/test/24-personal-feed.suite.js'
for file in $FILES; do
  mkdir -p "$BACKUP/$(dirname "$file")"
  cp -p "$ACTIVE/$file" "$BACKUP/$file"
done
[ ! -f "$ACTIVE/docs/openapi.json" ] || cp -p "$ACTIVE/docs/openapi.json" "$BACKUP/openapi.json"
printf '%s\n%s\n' "$OLD_SERVER" "$OLD_NGINX" > "$BACKUP/image-ids"
swapped=0
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$swapped" = 1 ] && [ "$complete" = 0 ]; then
    echo 'Video badge acceptance failed; restoring previous application images and source' >&2
    docker image tag "soulsguide-server:rollback-$RELEASE" soulsguide-server
    docker image tag "soulsguide-nginx:rollback-$RELEASE" soulsguide-nginx
    cp -a "$BACKUP/dist/." "$ACTIVE/client/dist/"
    for file in $FILES; do cp -p "$BACKUP/$file" "$ACTIVE/$file"; done
    [ ! -f "$BACKUP/openapi.json" ] || cp -p "$BACKUP/openapi.json" "$ACTIVE/docs/openapi.json"
    cd "$ACTIVE"
    docker compose up -d --no-deps --no-build server nginx || status=1
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' HUP INT TERM
swapped=1
cp -a "$STAGE/client/dist/." "$ACTIVE/client/dist/"
for file in $FILES; do cp -p "$STAGE/$file" "$ACTIVE/$file"; done
for file in client/src/components/VideoCoverBadge.vue client/checks/video-cover.test.mjs client/VideoBadge.Dockerfile server/VideoBadge.Dockerfile ops/deploy-video-badge.sh docs/openapi.json; do
  mkdir -p "$ACTIVE/$(dirname "$file")"
  cp -p "$STAGE/$file" "$ACTIVE/$file"
done
docker image tag "soulsguide-server:$RELEASE" soulsguide-server
cd "$ACTIVE"
docker compose up -d --no-deps --no-build server
attempt=0
until docker compose exec -T server node -e 'fetch("http://127.0.0.1:3000/health/ready").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))'; do
  attempt=$((attempt+1)); [ "$attempt" -lt 30 ] || exit 6; sleep 1
done
docker compose exec -T server node -e 'fetch("http://127.0.0.1:3000/api/posts?ids=1,2,4,12").then(async r=>{const j=await r.json();if(r.status!==200||j.code!==0||j.data.total!==4||!j.data.list.every(p=>p.has_video===(p.id!==1)))process.exit(1)}).catch(()=>process.exit(1))'
docker image tag "soulsguide-nginx:$RELEASE" soulsguide-nginx
docker compose up -d --no-deps --no-build nginx
attempt=0
until curl -fsS -H 'Host: 116.62.158.251' http://127.0.0.1/release.json | grep -q "$RELEASE"; do
  attempt=$((attempt+1)); [ "$attempt" -lt 15 ] || exit 6; sleep 1
done
docker compose exec -T nginx nginx -t
curl -fsS -H 'Host: 116.62.158.251' 'http://127.0.0.1/api/posts?pageSize=15' >/dev/null
complete=1
printf 'VIDEO_BADGE_DEPLOY_OK=%s\n' "$RELEASE"
docker compose ps
