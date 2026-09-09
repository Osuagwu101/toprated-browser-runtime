<?php

namespace App\Http\Controllers;

use App\Exceptions\RuntimeApiException;
use App\Services\ToolAuthenticationState;
use App\Services\ToolProfileRegistry;
use App\Services\ApprovedBrowserStateVault;
use App\Services\SessionManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ToolAuthController
{
    public function show(
        string $tool,
        ToolProfileRegistry $toolProfiles,
        ToolAuthenticationState $toolAuthentication,
        ApprovedBrowserStateVault $approvedStates,
    ): JsonResponse {
        $profile = $toolProfiles->resolve($tool, 'runtime-operator');

        return response()->json([
            ...$toolAuthentication->status($tool),
            'authenticationRequired' => ($profile['authentication']['required'] ?? false) === true,
            'adminProfileConfigured' => ($profile['adminProfile']['enabled'] ?? false) === true,
            'approvedState' => $approvedStates->metadata($tool),
        ]);
    }

    public function startSession(
        Request $request,
        string $tool,
        ToolProfileRegistry $toolProfiles,
        SessionManager $sessions,
    ): JsonResponse {
        $this->assertEmptyBody($request);
        $profile = $toolProfiles->resolve($tool, 'runtime-operator');
        $result = $sessions->startAdminAuthentication($tool, $profile);

        return response()->json($result, $result['reused'] ? 200 : 201);
    }

    public function approveSession(
        Request $request,
        string $tool,
        string $session,
        ToolProfileRegistry $toolProfiles,
        SessionManager $sessions,
    ): JsonResponse {
        $this->assertEmptyBody($request);
        $profile = $toolProfiles->resolve($tool, 'runtime-operator');

        return response()->json($sessions->approveAdminAuthentication($session, $tool, $profile));
    }

    public function destroySession(
        Request $request,
        string $tool,
        string $session,
        ToolProfileRegistry $toolProfiles,
        SessionManager $sessions,
    ): JsonResponse {
        $this->assertEmptyBody($request);
        $toolProfiles->resolve($tool, 'runtime-operator');

        return response()->json($sessions->closeAdminAuthentication($session, $tool));
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

    private function assertEmptyBody(Request $request): void
    {
        if ($request->all() !== []) {
            throw new RuntimeApiException('OPERATOR_AUTH_BODY_FORBIDDEN', 422, 'Administrator authentication operations accept no request fields.');
        }
    }
}
