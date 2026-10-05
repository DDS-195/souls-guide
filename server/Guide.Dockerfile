FROM soulsguide-server:pre-guide-20260930
COPY --chown=node:node server/src/ /app/src/
COPY --chown=node:node server/db/migrations/ /app/db/migrations/
COPY --chown=node:node server/test/ /app/test/
COPY --chown=node:node docs/ /docs/
