<?php

use App\Http\Controllers\CapacityController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\SessionController;
use App\Http\Controllers\ToolAuthController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [HealthController::class, 'show']);

Route::middleware(['runtime.security:service', 'service.auth'])->group(function (): void {
    Route::get('/capacity', [CapacityController::class, 'show']);
    Route::post('/sessions', [SessionController::class, 'store']);
    Route::get('/sessions/{session}', [SessionController::class, 'show']);
    Route::post('/sessions/{session}/heartbeat', [SessionController::class, 'heartbeat']);
    Route::post('/sessions/{session}/activity', [SessionController::class, 'activity']);
    Route::post('/sessions/{session}/viewer-grant', [SessionController::class, 'viewerGrant']);
    Route::delete('/sessions/{session}', [SessionController::class, 'destroy']);
});

Route::middleware(['runtime.security:operator', 'operator.auth'])->prefix('/operator')->group(function (): void {
    Route::get('/tool-auth/{tool}', [ToolAuthController::class, 'show']);
    Route::post('/tool-auth/{tool}/sessions', [ToolAuthController::class, 'startSession']);
    Route::post('/tool-auth/{tool}/sessions/{session}/approve', [ToolAuthController::class, 'approveSession']);
    Route::delete('/tool-auth/{tool}/sessions/{session}', [ToolAuthController::class, 'closeSession']);
    Route::post('/tool-auth/{tool}/restore', [ToolAuthController::class, 'restore']);
});
