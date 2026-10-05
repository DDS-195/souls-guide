FROM soulsguide-nginx:pre-writing-20260930
COPY client/dist/ /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
