# Standalone Migration Audit — Through Phase 3

Status: IN PROGRESS — final closure requires green CI on `verified-through-phase3` and promotion to standalone `main`.

## Verified source

Source repository: `Osuagwu101/topratedseotools-0bc24c5f`

Source branch: `self-hosted-browser-phase3`

Verified source head: `1e20dfdb529117f237ef021a53f13190f88def16`

Source Phase 3 CI: GitHub Actions run `33849890949`, job `100950047799` — SUCCESS.

## Target

Standalone repository: `Osuagwu101/toprated-browser-runtime`

Migration branch: `verified-through-phase3`

The existing historical Phase 1, Phase 2 and Phase 3 branches in this repository are retained as audit history and are not being rewritten.

## Migration gate

The target branch must demonstrate, in one fresh standalone CI environment:

1. Node worker unit tests and PHP/JSON syntax validation;
2. Docker build and independent runtime boot;
3. API and worker health contracts;
4. generic runtime with no Phrasly-specific production logic;
5. localhost-only worker publication and no raw CDP port mapping;
6. repeated Chromium start/navigate/stop lifecycle with clean tracked process teardown;
7. secure viewer shell and security headers;
8. missing/forged/cross-session authorization rejection;
9. authenticated JPEG frame capture;
10. mouse, keyboard/text and scroll interaction;
11. three reconnect checks retaining the same browser session and PID;
12. unsupported shell input rejection;
13. viewer invalidation after browser stop;
14. no tracked orphan/zombie Chromium process and an independent post-stop process scan; and
15. complete Docker Compose teardown.

## Production containment

No migration action modifies the production `main` branch of `Osuagwu101/topratedseotools-0bc24c5f`, changes the active Browser Use provider, modifies writer grants, or routes production traffic to Self Hosted.

## Exit criterion

`SB-001-001` closes only after this standalone branch passes the complete migration gate and the validated result is promoted to standalone `main`. Phase 4 must not begin before that closure.
