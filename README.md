# Top Rated Browser Runtime

Portable, generic self-hosted browser infrastructure for Top Rated SEO Tools.

This repository is deliberately separate from the production application. It is built against the **Self-Hosted Browser Master Blueprint v1.1** and the **Development, Audit & Deployment Approach v1.0**.

## Phase 1 scope

Phase 1 establishes only the isolated runtime foundation:

- Laravel control-plane skeleton
- Node.js browser-worker skeleton
- Chromium-capable worker container
- Docker Compose topology
- health endpoints
- environment template
- audit and issue-register structure
- CI that builds, boots, checks, and tears the runtime down

It does **not** connect to the production Top Rated SEO Tools application, Browser Use, Phrasly, or any writer account.

## Architecture boundary

The runtime core is tool-generic. Tool-specific profiles and authentication behavior are later phases. The browser worker identifies itself only as a generic `self_hosted` Chromium provider.

## Local boot

```bash
cp .env.example .env
docker compose up --build -d
curl http://localhost:18080/api/health
curl http://localhost:18081/health
docker compose down -v --remove-orphans
```

## Phase gates

No later phase begins until the current phase passes functional testing, root-cause review, regression testing, and Blueprint conformance audit.
