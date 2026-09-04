FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium curl dumb-init ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY src ./src
COPY test ./test

ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium

EXPOSE 8081

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
