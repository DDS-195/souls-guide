FROM soulsguide-server:pre-perf-20260928b
COPY --chown=node:node server/ /app/
