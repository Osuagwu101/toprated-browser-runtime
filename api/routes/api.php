<?php

use Illuminate\Support\Facades\Route;

Route::get('/health', static function () {
    return response()->json([
        'status' => 'ok',
        'service' => 'browser-runtime-api',
        'provider' => 'self_hosted',
        'phase' => 3,
        'tool_specific' => false,
        'viewer' => 'restricted_websocket',
        'raw_cdp_exposed' => false,
    ]);
});
