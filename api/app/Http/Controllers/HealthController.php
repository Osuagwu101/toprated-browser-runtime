<?php

namespace App\Http\Controllers;

use App\Services\BrowserWorkerClient;
use App\Services\ViewerGrantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

final class HealthController
{
    public function show(BrowserWorkerClient $worker, ViewerGrantService $viewerGrants): JsonResponse
    {
        $databaseHealthy = false;
        $workerHealthy = false;
        $configurationHealthy = false;

        try {
            DB::select('select 1');
            $databaseHealthy = true;
        } catch (Throwable) {
            $databaseHealthy = false;
        }

        try {
            $health = $worker->health();
            $workerHealthy = ($health['status'] ?? null) === 'ok'
                && ($health['phase'] ?? null) === 4
                && ($health['lifecycleOwner'] ?? null) === 'laravel'
                && ($health['viewer']['grantIssuer'] ?? null) === 'laravel';
        } catch (Throwable) {
            $workerHealthy = false;
        }

        try {
            $viewerGrants->assertConfigured();
            $configurationHealthy = strlen((string) config('browser.service_auth_secret', '')) >= 32
                && strlen((string) config('browser.worker_control_secret', '')) >= 32
                && (int) config('browser.max_browser_sessions', 1) === 1;
        } catch (Throwable) {
            $configurationHealthy = false;
        }

        $healthy = $databaseHealthy && $workerHealthy && $configurationHealthy;

        return response()->json([
            'status' => $healthy ? 'ok' : 'degraded',
            'service' => 'control-plane',
            'phase' => 4,
            'browser_core' => 'generic',
            'session_owner' => 'laravel',
            'viewer_grant_issuer' => 'laravel',
            'service_auth' => 'hmac-sha256-timestamp-nonce-v1',
            'database' => $databaseHealthy ? 'ok' : 'unavailable',
            'browser_worker' => $workerHealthy ? 'ok' : 'unavailable',
            'configuration' => $configurationHealthy ? 'ok' : 'invalid',
        ], $healthy ? 200 : 503);
    }
}
