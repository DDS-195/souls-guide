# Only used after deploy-audit-release.sh proves production lock fingerprints match.
# Fresh installs continue to use server/Dockerfile with npm ci and FFmpeg install.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=node:node server/src/ /app/src/
COPY --chown=node:node server/db/ /app/db/
COPY --chown=node:node server/test/ /app/test/
COPY --chown=node:node server/scripts/ /app/scripts/
COPY --chown=node:node server/server.js server/package.json server/package-lock.json /app/
RUN node --check /app/server.js && node --check /app/src/services/videoService.js && node --check /app/src/services/creatorService.js
