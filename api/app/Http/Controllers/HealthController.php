<?php

namespace App\Http\Controllers;

use App\Services\BrowserWorkerClient;
use App\Services\SessionManager;
use App\Services\ViewerGrantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

final class HealthController
{
    public function show(BrowserWorkerClient $worker, ViewerGrantService $viewerGrants, SessionManager $sessions): JsonResponse
    {
        $databaseHealthy = false;
        $workerHealthy = false;
        $configurationHealthy = false;
        $lifecycle = null;

        try {
            DB::select('select 1');
            $databaseHealthy = true;
        } catch (Throwable) {
            $databaseHealthy = false;
        }

        $configuredMaxSessions = (int) config('browser.max_browser_sessions', 1);
        try {
            $health = $worker->health();
            $workerHealthy = ($health['status'] ?? null) === 'ok'
                && ($health['phase'] ?? null) === 6
                && ($health['lifecycleOwner'] ?? null) === 'laravel'
                && ($health['viewer']['grantIssuer'] ?? null) === 'laravel'
                && ($health['viewer']['rawCdpExposed'] ?? true) === false
                && ($health['capacity']['configurationValid'] ?? false) === true
                && (int) ($health['capacity']['maxSessions'] ?? 0) === $configuredMaxSessions;
        } catch (Throwable) {
            $workerHealthy = false;
        }

        try {
            $viewerGrants->assertConfigured();
            $lifecycle = $sessions->lifecycleConfiguration();
            $configurationHealthy = strlen((string) config('browser.service_auth_secret', '')) >= 32
                && strlen((string) config('browser.worker_control_secret', '')) >= 32
                && $configuredMaxSessions >= 2
                && $configuredMaxSessions <= 15;
        } catch (Throwable) {
            $configurationHealthy = false;
        }

        $healthy = $databaseHealthy && $workerHealthy && $configurationHealthy;

        return response()->json([
            'status' => $healthy ? 'ok' : 'degraded',
            'service' => 'control-plane',
            'phase' => 6,
            'browser_core' => 'generic',
            'session_owner' => 'laravel',
            'viewer_grant_issuer' => 'laravel',
            'service_auth' => 'hmac-sha256-timestamp-nonce-v1',
            'database' => $databaseHealthy ? 'ok' : 'unavailable',
            'browser_worker' => $workerHealthy ? 'ok' : 'unavailable',
            'configuration' => $configurationHealthy ? 'ok' : 'invalid',
            'max_browser_sessions' => $configuredMaxSessions,
            'lifecycle' => $lifecycle,
        ], $healthy ? 200 : 503);
    }
}
