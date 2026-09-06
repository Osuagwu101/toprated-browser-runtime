<?php

namespace App\Http\Controllers;

use App\Exceptions\RuntimeApiException;
use App\Services\ToolAuthenticationState;
use App\Services\ToolProfileRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ToolAuthController
{
    public function show(
        string $tool,
        ToolProfileRegistry $toolProfiles,
        ToolAuthenticationState $toolAuthentication,
    ): JsonResponse {
        $profile = $toolProfiles->resolve($tool, 'runtime-operator');

        return response()->json([
            ...$toolAuthentication->status($tool),
            'authenticationRequired' => ($profile['authentication']['required'] ?? false) === true,
        ]);
    }

    public function restore(
        Request $request,
        string $tool,
        ToolProfileRegistry $toolProfiles,
        ToolAuthenticationState $toolAuthentication,
    ): JsonResponse {
        if ($request->all() !== []) {
            throw new RuntimeApiException(
                'OPERATOR_AUTH_BODY_FORBIDDEN',
                422,
                'Authentication restoration accepts no tool credentials or verification codes.',
            );
        }

        $profile = $toolProfiles->resolve($tool, 'runtime-operator');
        if (($profile['authentication']['required'] ?? false) !== true) {
            throw new RuntimeApiException('TOOL_AUTH_NOT_MANAGED', 422, 'This configured tool does not require shared authentication.');
        }

        return response()->json($toolAuthentication->markRestored($tool));
    }
}
