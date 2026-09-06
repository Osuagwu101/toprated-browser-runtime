#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
fi

replace_placeholder() {
  local placeholder="$1"
  local replacement="$2"
  if grep -Fq "$placeholder" "$ENV_FILE"; then
    sed -i "s|$placeholder|$replacement|g" "$ENV_FILE"
  fi
}

replace_placeholder "base64:replace-with-a-valid-laravel-application-key" "base64:$(openssl rand -base64 32)"
replace_placeholder "replace-with-a-random-worker-control-secret-at-least-32-bytes-long" "$(openssl rand -hex 32)"
replace_placeholder "replace-with-a-random-service-secret-at-least-32-bytes-long" "$(openssl rand -hex 32)"
replace_placeholder "replace-with-a-random-secret-at-least-32-bytes-long" "$(openssl rand -hex 32)"

chmod 600 "$ENV_FILE"

if grep -Eq 'replace-with-|APP_KEY=base64:replace' "$ENV_FILE"; then
  printf 'bootstrap_error=unreplaced_placeholder\n' >&2
  exit 1
fi

if command -v php >/dev/null 2>&1; then
  bash scripts/typecheck.sh
else
  printf 'host_php=unavailable_using_docker_build_validation\n'
  docker compose config --quiet
fi

docker compose build
docker compose up -d

wait_for_health() {
  local url="$1"
  local label="$2"
  local attempts=60
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if curl --fail --silent --show-error "$url" >/tmp/"$label"-health.json 2>/dev/null; then
      printf '%s_health=pass\n' "$label"
      sed -E 's/("(token|secret|cookie|authorization)"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"[redacted]"/Ig' /tmp/"$label"-health.json
      printf '\n'
      return 0
    fi
    sleep 2
  done
  printf '%s_health=fail\n' "$label" >&2
  docker compose ps >&2
  docker compose logs --tail=80 api browser-worker >&2
  return 1
}

wait_for_health "http://127.0.0.1:18080/api/health" "api"
wait_for_health "http://127.0.0.1:18081/health" "worker"

docker compose ps
printf 'codespace_bootstrap=pass\n'
