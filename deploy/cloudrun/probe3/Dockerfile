# Probe 3: apt + COPY from build context (no multi-stage)
FROM supabase/postgres:15.8.1.060
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/*
COPY hello.conf /etc/nginx/conf.d/default.conf
RUN nginx -t
