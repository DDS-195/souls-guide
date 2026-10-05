#!/bin/sh
# Frontend-only release. Never modify backend containers, credentials or database volumes.
set -eu
umask 077
RELEASE=sg-20261004-home-layout-r1
STAGE=/opt/soulsguide-home-layout-20261004-r1
BACKUP=/opt/soulsguide-home-layout-backup-20261004-r1
ACTIVE=/opt/soulsguide
case "$(readlink -f "$ACTIVE")" in /opt/soulsguide) ;; *) exit 2 ;; esac
[ -s "$STAGE/client/dist/release.json" ] && [ -s "$STAGE/frontend-files.sha256" ] || exit 2
[ ! -e "$BACKUP" ] || { echo 'Backup target already exists' >&2; exit 2; }
cd "$STAGE"
sha256sum -c frontend-files.sha256
grep -q "$RELEASE" client/dist/release.json
export COMPOSE_PROJECT_NAME=soulsguide
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod-http.yml
PREVIOUS_IMAGE=$(docker inspect sg-nginx --format '{{.Image}}')
docker image tag "$PREVIOUS_IMAGE" "soulsguide-nginx:rollback-$RELEASE"
docker build --pull=false --build-arg "BASE_IMAGE=soulsguide-nginx:rollback-$RELEASE" \
  -f client/HomeLayout.Dockerfile -t "soulsguide-nginx:$RELEASE" .
# Validate the inherited Nginx template without launching an additional public listener.
docker run --rm -e SITE_HOST=116.62.158.251 --network soulsguide_default \
  --entrypoint sh "soulsguide-nginx:$RELEASE" -c '/docker-entrypoint.d/19-site-config.sh && nginx -t'
mkdir "$BACKUP"
cp -a "$ACTIVE/client/dist" "$BACKUP/dist"
FILES='client/src/App.vue client/src/views/Home.vue client/src/style.css client/package.json'
for file in $FILES; do
  mkdir -p "$BACKUP/$(dirname "$file")"
  cp -p "$ACTIVE/$file" "$BACKUP/$file"
done
printf '%s\n' "$PREVIOUS_IMAGE" > "$BACKUP/nginx-image-id"
swapped=0
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$swapped" = 1 ] && [ "$complete" = 0 ]; then
    echo 'Frontend acceptance failed; restoring previous frontend' >&2
    docker image tag "soulsguide-nginx:rollback-$RELEASE" soulsguide-nginx
    cp -a "$BACKUP/dist/." "$ACTIVE/client/dist/"
    for file in $FILES; do cp -p "$BACKUP/$file" "$ACTIVE/$file"; done
    cd "$ACTIVE"
    docker compose up -d --no-deps --no-build nginx || status=1
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' HUP INT TERM
swapped=1
# Overlay instead of removing old assets: tabs opened before the release still work.
cp -a "$STAGE/client/dist/." "$ACTIVE/client/dist/"
for file in $FILES; do cp -p "$STAGE/$file" "$ACTIVE/$file"; done
cp -p "$STAGE/client/checks/home-pagination.test.mjs" "$ACTIVE/client/checks/home-pagination.test.mjs"
cp -p "$STAGE/client/HomeLayout.Dockerfile" "$ACTIVE/client/HomeLayout.Dockerfile"
cp -p "$STAGE/ops/deploy-home-layout.sh" "$ACTIVE/ops/deploy-home-layout.sh"
docker image tag "soulsguide-nginx:$RELEASE" soulsguide-nginx
cd "$ACTIVE"
docker compose up -d --no-deps --no-build nginx
attempt=0
until curl -fsS -H 'Host: 116.62.158.251' http://127.0.0.1/release.json | grep -q "$RELEASE"; do
  attempt=$((attempt+1)); [ "$attempt" -lt 15 ] || exit 6; sleep 1
done
docker compose exec -T nginx nginx -t
curl -fsS -H 'Host: 116.62.158.251' 'http://127.0.0.1/api/posts?pageSize=15' >/dev/null
curl -fsS -H 'Host: 116.62.158.251' http://127.0.0.1/api/games >/dev/null
complete=1
printf 'FRONTEND_DEPLOY_OK=%s\n' "$RELEASE"
docker compose ps
