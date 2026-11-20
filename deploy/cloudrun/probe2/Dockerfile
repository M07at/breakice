# Probe 2: does COPY --from work in this builder?
FROM denoland/deno:debian-1.44.0 AS deno
FROM supabase/postgres:15.8.1.060
COPY --from=deno /usr/bin/deno /usr/local/bin/deno
RUN /usr/local/bin/deno --version
