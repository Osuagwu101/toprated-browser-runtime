<?php

namespace App\Http\Controllers;

use App\Services\BrowserWorkerClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

final class HealthController
{
    public function show(BrowserWorkerClient $worker): JsonResponse
    {
        $databaseHealthy = false;
        $workerHealthy = false;

        try {
            DB::select('select 1');
            $databaseHealthy = true;
        } catch (Throwable) {
            $databaseHealthy = false;
        }

        try {
            $health = $worker->health();
            $workerHealthy = ($health['status'] ?? null) === 'ok';
        } catch (Throwable) {
            $workerHealthy = false;
        }

        $healthy = $databaseHealthy && $workerHealthy;

        return response()->json([
            'status' => $healthy ? 'ok' : 'degraded',
            'service' => 'control-plane',
            'phase' => 4,
            'browser_core' => 'generic',
            'session_owner' => 'laravel',
            'service_auth' => 'hmac-sha256-timestamp-nonce-v1',
            'database' => $databaseHealthy ? 'ok' : 'unavailable',
            'browser_worker' => $workerHealthy ? 'ok' : 'unavailable',
        ], $healthy ? 200 : 503);
    }
}
