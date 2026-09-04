<?php

return [
    'worker_url' => rtrim((string) env('BROWSER_WORKER_URL', 'http://browser-worker:8081'), '/'),
    'worker_control_secret' => (string) env('WORKER_CONTROL_SECRET', ''),
    'service_auth_secret' => (string) env('RUNTIME_SERVICE_AUTH_SECRET', ''),
    'service_auth_max_skew_seconds' => (int) env('SERVICE_AUTH_MAX_SKEW_SECONDS', 300),
    'viewer_signing_secret' => (string) env('VIEWER_SIGNING_SECRET', ''),
    'viewer_token_ttl_seconds' => (int) env('VIEWER_TOKEN_TTL_SECONDS', 300),
    'viewer_public_base_url' => rtrim((string) env('VIEWER_PUBLIC_BASE_URL', 'http://127.0.0.1:18081'), '/'),
    'max_browser_sessions' => (int) env('MAX_BROWSER_SESSIONS', 1),
];
