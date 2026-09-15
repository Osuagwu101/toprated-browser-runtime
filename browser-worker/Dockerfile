FROM node:22-bookworm-slim

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get -o Acquire::Retries=10 -o Acquire::http::Timeout=120 update \
    && apt-get -o Acquire::Retries=10 -o Acquire::http::Timeout=120 install -y --no-install-recommends \
      ca-certificates curl gnupg chromium xvfb xauth xdotool imagemagick \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get -o Acquire::Retries=10 -o Acquire::http::Timeout=120 update \
    && apt-get -o Acquire::Retries=10 -o Acquire::http::Timeout=120 install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/browser-worker
COPY browser-worker/package.json ./package.json
COPY browser-worker/src ./src
COPY browser-worker/test ./test

ENV NODE_ENV=production
ENV PORT=8081
ENV CHROMIUM_EXECUTABLE=/usr/bin/google-chrome-stable
ENV GOOGLE_CHROME_EXECUTABLE=/usr/bin/google-chrome-stable

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin browser \
    && mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && chown root:root /opt/google/chrome/chrome-sandbox \
    && chmod 4755 /opt/google/chrome/chrome-sandbox \
    && chown -R browser:browser /srv/browser-worker \
    && node --test test/*.test.mjs \
    && test -x /usr/bin/google-chrome-stable \
    && test -x /usr/bin/chromium \
    && test -x /usr/bin/Xvfb \
    && test -x /usr/bin/xdotool \
    && test -x /usr/bin/import

USER browser

EXPOSE 8081
CMD ["node", "src/server.mjs"]
