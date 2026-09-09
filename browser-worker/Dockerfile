FROM node:22-bookworm-slim

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get -o Acquire::Retries=10 -o Acquire::http::Timeout=120 update \
    && apt-get -o Acquire::Retries=10 -o Acquire::http::Timeout=120 install -y --no-install-recommends chromium curl ca-certificates xvfb xauth

WORKDIR /srv/browser-worker
COPY browser-worker/package.json ./package.json
COPY browser-worker/src ./src
COPY browser-worker/test ./test
COPY browser-worker/policies/managed.json /etc/chromium/policies/managed/toprated-runtime.json

ENV NODE_ENV=production
ENV PORT=8081
ENV CHROMIUM_EXECUTABLE=/usr/bin/chromium
ENV ADMIN_PROFILE_ROOT=/var/lib/toprated-browser-runtime/admin-profiles

RUN node --test test/*.test.mjs \
    && test -x /usr/bin/chromium \
    && test -x /usr/bin/xvfb-run \
    && test -x /usr/bin/xauth \
    && test -f /etc/chromium/policies/managed/toprated-runtime.json \
    && mkdir -p /var/lib/toprated-browser-runtime/admin-profiles \
    && chmod 0700 /var/lib/toprated-browser-runtime/admin-profiles

EXPOSE 8081
CMD ["node", "src/server.mjs"]
