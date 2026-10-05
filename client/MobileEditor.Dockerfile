FROM soulsguide-nginx:pre-mobile-editor-20261001
COPY client/dist/ /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
