FROM soulsguide-nginx:pre-audit-fixes-20261002
COPY client/dist/ /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
