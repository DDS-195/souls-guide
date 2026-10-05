# Frontend-only patch: inherit the current proxy configuration and old hashed assets.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY client/dist /usr/share/nginx/html
RUN chmod -R o+rX /usr/share/nginx/html
