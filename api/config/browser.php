<?php

return [
    'worker_url' => rtrim((string) env('BROWSER_WORKER_URL', 'http://browser-worker:8081'), '/'),
    'worker_control_secret' => (string) env('WORKER_CONTROL_SECRET', ''),
    'service_auth_secret' => (string) env('RUNTIME_SERVICE_AUTH_SECRET', ''),
    'service_auth_max_skew_seconds' => (int) env('SERVICE_AUTH_MAX_SKEW_SECONDS', 300),
    'viewer_signing_secret' => (string) env('VIEWER_SIGNING_SECRET', ''),
    'viewer_token_ttl_seconds' => (int) env('VIEWER_TOKEN_TTL_SECONDS', 300),
    'viewer_public_base_url' => rtrim((string) env('VIEWER_PUBLIC_BASE_URL', 'http://127.0.0.1:18081'), '/'),
    'max_browser_sessions' => (int) env('MAX_BROWSER_SESSIONS', 3),
    'session_lease_seconds' => (int) env('SESSION_LEASE_SECONDS', 5400),
    'session_idle_timeout_seconds' => (int) env('SESSION_IDLE_TIMEOUT_SECONDS', 900),
    'session_disconnect_grace_seconds' => (int) env('SESSION_DISCONNECT_GRACE_SECONDS', 180),
    'session_startup_grace_seconds' => (int) env('SESSION_STARTUP_GRACE_SECONDS', 30),
    'session_reaper_interval_seconds' => (int) env('SESSION_REAPER_INTERVAL_SECONDS', 30),
    'tool_profiles_path' => (string) env('TOOL_PROFILES_PATH', base_path('config/tool-profiles.json')),
];
