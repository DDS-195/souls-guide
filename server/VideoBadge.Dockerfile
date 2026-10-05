# Dependencies, startup and security configuration are inherited unchanged.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=node:node server/src/services/postService.js /app/src/services/postService.js
COPY --chown=node:node server/test/17-home-feed.suite.js server/test/24-personal-feed.suite.js /app/test/
COPY --chown=node:node docs/openapi.json /docs/openapi.json
RUN node --check /app/src/services/postService.js
