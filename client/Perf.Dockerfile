FROM soulsguide-nginx:pre-perf-20260926
COPY client/dist/ /usr/share/nginx/html/
RUN chmod -R o+rX /usr/share/nginx/html
