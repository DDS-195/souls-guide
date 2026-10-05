#!/bin/sh
# Additive revision release. Never replace the business database or media volumes.
set -eu
umask 077
RELEASE=sg-20261005-post-revisions-r1
STAGE=/opt/soulsguide-release-20261005-post-revisions-r1
ACTIVE=/opt/soulsguide
PREVIOUS=/opt/soulsguide-previous-20261005-post-revisions-r1
for target in "$STAGE" "$ACTIVE"; do
  [ "$(readlink -f "$target")" = "$target" ] || exit 2
done
[ ! -e "$PREVIOUS" ] || exit 2
[ -s "$STAGE/client/dist/release.json" ] && [ -s "$STAGE/release-manifest.json" ] || exit 2
export COMPOSE_PROJECT_NAME=soulsguide
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod-http.yml
cp "$ACTIVE/.env" "$STAGE/.env"
chmod 600 "$STAGE/.env"
docker image tag "$(docker inspect sg-server --format '{{.Image}}')" "soulsguide-server:rollback-$RELEASE"
docker image tag "$(docker inspect sg-nginx --format '{{.Image}}')" "soulsguide-nginx:rollback-$RELEASE"
cd "$STAGE"
docker compose config --quiet
# Verify exact candidate file hashes before building or changing the active checkout.
docker run --rm --user=0 --network=none --cap-drop=ALL --security-opt=no-new-privileges --memory=128m -v "$STAGE:/release:ro" --entrypoint node "soulsguide-server:rollback-$RELEASE" -e '
const fs=require("fs"),crypto=require("crypto"),m=require("/release/release-manifest.json");
for(const f of m.files){const h=crypto.createHash("sha256").update(fs.readFileSync("/release/"+f.path)).digest("hex");if(h!==f.sha256)throw Error("source hash mismatch: "+f.path)}
for(const f of m.frontend){const h=crypto.createHash("sha256").update(fs.readFileSync("/release/client/dist/assets/"+f.name)).digest("hex");if(h!==f.sha256)throw Error("frontend hash mismatch: "+f.name)}
if(m.release!=="sg-20261005-post-revisions-r1")throw Error("wrong release");console.log("RELEASE_HASHES_OK");'
fingerprint='const p=require(process.argv[1]);const entries=Object.entries(p.packages).filter(([k,v])=>k&&!v.dev).map(([k,v])=>[k,v.version,v.integrity]).sort();console.log(require("crypto").createHash("sha256").update(JSON.stringify(entries)).digest("hex"))'
expected=$(docker run --rm --memory=128m -v "$STAGE/server/package-lock.json:/candidate-lock.json:ro" --entrypoint node "soulsguide-server:rollback-$RELEASE" -e "$fingerprint" /candidate-lock.json)
installed=$(docker exec sg-server node -e "$fingerprint" /app/package-lock.json)
[ "$expected" = "$installed" ] && [ -n "$expected" ] || { echo 'Dependency mismatch; refuse base-image reuse' >&2; exit 2; }
docker compose config --format json | docker run --rm -i --user=0 --network=none --cap-drop=ALL --security-opt=no-new-privileges --memory=128m -v "$STAGE:/release:ro" \
  --entrypoint node "soulsguide-server:rollback-$RELEASE" -e 'let data="";process.stdin.on("data",x=>data+=x);process.stdin.on("end",()=>{require("/release/ops/preflight.cjs").validateCompose(JSON.parse(data));console.log("PREFLIGHT_OK")})'
docker build --pull=false --build-arg "BASE_IMAGE=soulsguide-server:rollback-$RELEASE" -f server/Release.Dockerfile -t "soulsguide-server:$RELEASE" .
# Inherit the current HTTP proxy configuration and old fingerprinted assets.
docker build --pull=false --build-arg "BASE_IMAGE=soulsguide-nginx:rollback-$RELEASE" -f client/HomeLayout.Dockerfile -t "soulsguide-nginx:$RELEASE" .
docker run --rm -e SITE_HOST=116.62.158.251 --network soulsguide_default --entrypoint sh "soulsguide-nginx:$RELEASE" \
  -c '/docker-entrypoint.d/19-site-config.sh && nginx -t'
if [ -d "$ACTIVE/client/dist/assets" ]; then
  for file in "$ACTIVE"/client/dist/assets/*; do
    [ -f "$file" ] || continue
    name=${file##*/}
    [ -e "$STAGE/client/dist/assets/$name" ] || cp "$file" "$STAGE/client/dist/assets/$name"
  done
fi
cd "$ACTIVE"
ALLOW_BACKUP_DOWNTIME=YES BACKUP_RETENTION_DAYS=14 sh ops/backup.sh /opt/soulsguide-backups
swapped=0
moved_previous=0
complete=0
rollback() {
  status=$?
  trap - EXIT
  if [ "$moved_previous" = 1 ] && [ "$complete" = 0 ]; then
    docker image tag "soulsguide-server:rollback-$RELEASE" soulsguide-server
    docker image tag "soulsguide-nginx:rollback-$RELEASE" soulsguide-nginx
    if [ "$swapped" = 1 ]; then mv "$ACTIVE" "$STAGE"; fi
    mv "$PREVIOUS" "$ACTIVE"
    cd "$ACTIVE"
    docker compose up -d --no-deps --no-build server nginx || status=1
    echo 'Application rollback performed; additive revision tables retained, never restore an old business database automatically' >&2
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' HUP INT TERM
mv "$ACTIVE" "$PREVIOUS"
moved_previous=1
mv "$STAGE" "$ACTIVE"
swapped=1
docker image tag "soulsguide-server:$RELEASE" soulsguide-server
docker image tag "soulsguide-nginx:$RELEASE" soulsguide-nginx
cd "$ACTIVE"
docker compose up -d --no-deps --no-build server nginx
attempt=0
until docker compose exec -T server node -e 'require("http").get("http://127.0.0.1:3000/health/ready",r=>process.exit(r.statusCode===200?0:1)).on("error",()=>process.exit(1))'; do
  attempt=$((attempt+1)); [ "$attempt" -lt 30 ] || exit 6; sleep 2
done
docker compose exec -T nginx nginx -t
curl -fsS -H 'Host: 116.62.158.251' http://127.0.0.1/release.json | grep -q "$RELEASE"
curl -fsS -H 'Host: 116.62.158.251' 'http://127.0.0.1/api/posts?pageSize=15' >/dev/null
complete=1
printf 'DEPLOY_OK=%s\n' "$RELEASE"
docker compose ps
