FROM supabase/postgres:15.8.1.060
USER root
RUN apt-get update && apt-get install -y --no-install-recommends nginx curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/cert /opt/app /etc/nginx/conf.d /var/lib/storage
RUN printf '#!/bin/sh\nexit 0\n' > /app/cert/initenv.sh && chmod +x /app/cert/initenv.sh
ENV PGDATA=/var/lib/postgresql/data
ENV STORAGE_DIR=/var/lib/storage
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh ./entrypoint.sh
COPY storage-shim.ts ./storage-shim.ts
COPY migrations ./migrations
COPY functions ./functions
COPY local/00-supabase-shim.sql ./00-supabase-shim.sql
WORKDIR /opt/app
RUN chmod +x /opt/app/entrypoint.sh
RUN nginx -t
RUN ls -la /opt/app && ls /opt/app/migrations | head -3
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD curl -fsS http://127.0.0.1/healthz || exit 1
ENTRYPOINT ["/opt/app/entrypoint.sh"]
