# Swagger Dark UI — static site, served by nginx.
#   docker build -t swagger-dark-ui .
#   docker run --rm -p 8080:80 swagger-dark-ui
# then open http://localhost:8080
FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY specs /usr/share/nginx/html/specs
COPY vendor /usr/share/nginx/html/vendor
COPY icons /usr/share/nginx/html/icons
COPY manifest.webmanifest sw.js /usr/share/nginx/html/

EXPOSE 80
