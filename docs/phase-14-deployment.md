# Phase 14 — Contabo Deployment

This bundle deploys the standalone runtime without exposing Laravel, the worker control API, Chromium CDP, Docker, or the host shell to writers.

## Required owner-controlled inputs

- A DNS name whose A record points to the VPS public IPv4 address.
- The initial Contabo administrative login, used only for the first SSH connection.
- A new owner-controlled SSH key. Remove password login only after key login is proven in a second connection.

Never paste passwords, private keys, API secrets, viewer grants, browser state, cookies, or the server address into GitHub, issues, chat, or ordinary logs.

## Deployment boundary

- Caddy is the only public container and publishes TCP 80/443 and UDP 443.
- `/api/health`, signed service lifecycle routes, and `/viewer/*` are proxied over the private Docker network.
- `/api/operator/*`, `/browser/*`, worker health, raw CDP, Docker, and SSH are not proxied to writers.
- API and worker host publications remain bound to `127.0.0.1` for operator diagnostics.

## First deployment

1. Point the chosen DNS name to the VPS.
2. Connect over SSH as the administrative user from an owner-controlled computer.
3. Prove a new SSH-key login in a second terminal before disabling password authentication.
4. Set `RUNTIME_DOMAIN` in the SSH session and run `phase14/scripts/bootstrap_ubuntu.sh` from a verified checkout.
5. Store the generated `/opt/toprated-browser-runtime/.env` securely on the VPS. It is mode `0600` and must not be committed.
6. Run the external acceptance script from a different network with `RUNTIME_BASE_URL` and `RUNTIME_SERVICE_AUTH_SECRET` supplied through the process environment.

Phase 14 is not technically green until the live external acceptance result is observed and all inherited workflows pass on the exact final branch head.
