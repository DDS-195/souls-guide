FROM soulsguide-server:pre-audit-fixes-20261002
COPY --chown=node:node server/src/ /app/src/
COPY --chown=node:node server/db/ /app/db/
COPY --chown=node:node server/test/ /app/test/
COPY --chown=node:node server/package.json server/package-lock.json /app/
COPY --chown=node:node docs/ /docs/
COPY --chown=node:node ops/ /ops/
RUN command -v flock && node --check /app/src/utils/logMaintenance.js
