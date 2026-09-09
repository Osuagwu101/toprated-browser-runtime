#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this bootstrap as root." >&2
  exit 1
fi

: "${RUNTIME_DOMAIN:?Set RUNTIME_DOMAIN to the DNS name pointing at this VPS}"

install_root=/opt/toprated-browser-runtime
repo_url=https://github.com/Osuagwu101/toprated-browser-runtime.git

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl git openssl docker.io docker-compose-v2 ufw
systemctl enable --now docker

if [[ ! -d "${install_root}/.git" ]]; then
  git clone --branch phase14-contabo-deployment --single-branch "${repo_url}" "${install_root}"
fi

cd "${install_root}"
git fetch origin phase14-contabo-deployment
git checkout phase14-contabo-deployment
git pull --ff-only origin phase14-contabo-deployment

if [[ ! -f .env ]]; then
  umask 077
  app_key="base64:$(openssl rand -base64 32)"
  worker_secret="$(openssl rand -hex 32)"
  service_secret="$(openssl rand -hex 32)"
  operator_secret="$(openssl rand -hex 32)"
  identity_key="$(openssl rand -base64 32 | tr -d '\n')"
  viewer_secret="$(openssl rand -hex 32)"
  cat > .env <<EOF
APP_ENV=production
APP_DEBUG=false
APP_KEY=${app_key}
APP_URL=https://${RUNTIME_DOMAIN}
RUNTIME_DOMAIN=${RUNTIME_DOMAIN}
VIEWER_PUBLIC_BASE_URL=https://${RUNTIME_DOMAIN}
WORKER_CONTROL_SECRET=${worker_secret}
RUNTIME_SERVICE_AUTH_SECRET=${service_secret}
RUNTIME_OPERATOR_AUTH_SECRET=${operator_secret}
BROWSER_IDENTITY_ENCRYPTION_KEY=${identity_key}
ALLOW_LEGACY_BROWSER_STATE_INPUT=false
ALLOW_LEGACY_AUTH_RESTORE=false
VIEWER_SIGNING_SECRET=${viewer_secret}
MAX_BROWSER_SESSIONS=3
LOG_LEVEL=info
EOF
  chmod 600 .env
fi

docker compose -f docker-compose.yml -f deploy/docker-compose.production.yml config --quiet
docker compose -f docker-compose.yml -f deploy/docker-compose.production.yml build
docker compose -f docker-compose.yml -f deploy/docker-compose.production.yml up -d

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

docker compose -f docker-compose.yml -f deploy/docker-compose.production.yml ps
echo "Deployment started. Wait for HTTPS provisioning, then run the external acceptance check from a different network."
