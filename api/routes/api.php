<?php

use Illuminate\Support\Facades\Route;

Route::get('/health', static function () {
    return response()->json([
        'status' => 'ok',
        'service' => 'browser-runtime-api',
        'provider' => 'self_hosted',
        'phase' => 2,
        'tool_specific' => false,
    ]);
});
