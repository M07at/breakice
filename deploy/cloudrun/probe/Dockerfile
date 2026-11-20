# Probe: only resolve the four base images, no COPY, no apt.
# If one tag does not exist, BuildKit reports which one.
FROM postgrest/postgrest:v12.2.3 AS postgrest
FROM supabase/gotrue:v2.151.0 AS gotrue
FROM denoland/deno:debian-1.44.0 AS deno
FROM supabase/postgres:15.8.1.060
RUN echo "all base images resolved"
