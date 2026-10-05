FROM soulsguide-nginx:pre-home-motion-20260929
COPY client/dist/ /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
