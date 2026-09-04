<?php

namespace App\Http\Controllers;

use App\Services\SessionManager;
use Illuminate\Http\JsonResponse;

final class CapacityController
{
    public function show(SessionManager $sessions): JsonResponse
    {
        return response()->json($sessions->capacity());
    }
}
