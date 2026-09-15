<?php

namespace App\Http\Controllers;

use App\Exceptions\RuntimeApiException;
use App\Services\AuthorizedBrowserState;
use App\Services\BrowserWorkerClient;
use App\Services\PersistentBrowserIdentity;
use App\Services\SessionManager;
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
        PersistentBrowserIdentity $identities,
    ): JsonResponse {
        $profile = $toolProfiles->resolve($tool, 'runtime-operator');

        return response()->json([
            ...$toolAuthentication->status($tool),
            'authenticationRequired' => ($profile['authentication']['required'] ?? false) === true,
            'identity' => $identities->metadata($tool),
        ]);
    }

    public function startSession(
        Request $request,
        string $tool,
        ToolProfileRegistry $toolProfiles,
        PersistentBrowserIdentity $identities,
        SessionManager $sessions,
    ): JsonResponse {
        $accountScope = $this->accountScope($request);
        $profile = $toolProfiles->resolve($tool, 'runtime-operator');
        if (($profile['authentication']['required'] ?? false) !== true) {
            throw new RuntimeApiException('TOOL_AUTH_NOT_MANAGED', 422, 'This configured tool does not require shared authentication.');
        }
        $identities->configuration();

        return response()->json(
            $sessions->startOperatorAuthentication($tool, $profile['adminLoginUrl'], $profile['browserState'], $accountScope),
            201,
        );
    }

    public function approveSession(
        Request $request,
        string $tool,
        string $session,
        ToolProfileRegistry $toolProfiles,
        ToolAuthenticationState $toolAuthentication,
        PersistentBrowserIdentity $identities,
        AuthorizedBrowserState $authorizedBrowserState,
        BrowserWorkerClient $worker,
        SessionManager $sessions,
    ): JsonResponse {
        $accountScope = $this->accountScope($request);
        $profile = $toolProfiles->resolve($tool, 'runtime-operator');
        if (($profile['authentication']['required'] ?? false) !== true) {
            throw new RuntimeApiException('TOOL_AUTH_NOT_MANAGED', 422, 'This configured tool does not require shared authentication.');
        }

        $workerSessionId = $sessions->operatorWorkerSessionId($session, $tool, $accountScope);
        $verified = $worker->verifyAuthentication($workerSessionId, $profile['authentication']);
        if (($verified['required'] ?? false) !== true || ($verified['verified'] ?? false) !== true) {
            throw new RuntimeApiException('TOOL_AUTH_NOT_VERIFIED', 409, 'Administrator authentication has not reached the configured approved state.');
        }

        $exported = $worker->exportAuthorizedState($workerSessionId);
        $capturedAt = is_string($exported['session_tokens']['captured_at'] ?? null)
            ? $exported['session_tokens']['captured_at']
            : null;
        $normalized = $authorizedBrowserState->normalize($exported, $profile['browserState'], $profile['launchUrl']);
        if ($normalized === null) {
            throw new RuntimeApiException('BROWSER_IDENTITY_INVALID', 422, 'Administrator browser did not contain reusable approved identity state.');
        }

        $identity = $identities->save($tool, $normalized, $capturedAt, $accountScope);
        $sessions->closeOperatorAuthentication($session, $tool, $accountScope);
        $auth = $toolAuthentication->markVerified($tool, $accountScope);

        return response()->json([
            ...$auth,
            'identity' => $identity,
            'administratorSessionClosed' => true,
        ]);
    }

    public function closeSession(
        Request $request,
        string $tool,
        string $session,
        ToolProfileRegistry $toolProfiles,
        SessionManager $sessions,
    ): JsonResponse {
        $accountScope = $this->accountScope($request);
        $toolProfiles->resolve($tool, 'runtime-operator');

        return response()->json($sessions->closeOperatorAuthentication($session, $tool, $accountScope));
    }

    public function restore(
        Request $request,
        string $tool,
        ToolProfileRegistry $toolProfiles,
        ToolAuthenticationState $toolAuthentication,
    ): JsonResponse {
        $this->assertEmptyBody($request);

        $profile = $toolProfiles->resolve($tool, 'runtime-operator');
        if (($profile['authentication']['required'] ?? false) !== true) {
            throw new RuntimeApiException('TOOL_AUTH_NOT_MANAGED', 422, 'This configured tool does not require shared authentication.');
        }

        if (config('browser.allow_legacy_auth_restore', false) !== true) {
            throw new RuntimeApiException(
                'ADMIN_REAUTH_SESSION_REQUIRED',
                409,
                'Start an administrator authentication session and approve its captured identity.',
            );
        }

        return response()->json($toolAuthentication->markRestored($tool));
    }

    private function accountScope(Request $request): string
    {
        $body = $request->all();
        $unexpected = array_diff(array_keys($body), ['account_id']);
        if ($unexpected !== []) {
            throw new RuntimeApiException(
                'OPERATOR_AUTH_BODY_FORBIDDEN',
                422,
                'Administrator authentication operations accept only an assigned account identifier, never credentials or verification codes.',
            );
        }

        $accountScope = trim((string) $request->input('account_id', ''));
        if ($accountScope === '') {
            return 'legacy';
        }
        if (! preg_match('/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/', $accountScope)) {
            throw new RuntimeApiException('INVALID_ACCOUNT_SCOPE', 422, 'The assigned account identifier is invalid.');
        }

        return $accountScope;
    }

    private function assertEmptyBody(Request $request): void
    {
        if ($request->all() !== []) {
            throw new RuntimeApiException(
                'OPERATOR_AUTH_BODY_FORBIDDEN',
                422,
                'Administrator authentication operations accept no credentials or verification codes.',
            );
        }
    }
}
