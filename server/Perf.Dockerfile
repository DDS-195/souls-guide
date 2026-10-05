FROM soulsguide-server:pre-perf-20260926
USER root
COPY server/package.json server/package-lock.json /app/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node -e "require('sharp')"
COPY --chown=node:node server/ /app/
USER node
