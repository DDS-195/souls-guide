FROM soulsguide-nginx:pre-motion-20260929
COPY client/dist/ /usr/share/nginx/html/
RUN chmod -R o+rX /usr/share/nginx/html
