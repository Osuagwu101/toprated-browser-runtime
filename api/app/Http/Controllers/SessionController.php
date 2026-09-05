<?php

namespace App\Http\Controllers;

use App\Exceptions\RuntimeApiException;
use App\Services\SessionManager;
use App\Services\ToolProfileRegistry;
use App\Services\ViewerGrantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class SessionController
{
    public function store(
        Request $request,
        SessionManager $sessions,
        ViewerGrantService $viewerGrants,
        ToolProfileRegistry $toolProfiles,
    ): JsonResponse {
        $writerId = $this->writerId($request);
        $bodyWriterId = trim((string) $request->input('writer_id', ''));
        $toolSlug = trim((string) $request->input('tool_slug', ''));

        if ($bodyWriterId === '' || ! hash_equals($writerId, $bodyWriterId)) {
            throw new RuntimeApiException('WRITER_ID_MISMATCH', 403, 'The signed writer identity does not match the launch request.');
        }
        if (strlen($writerId) > 191 || strlen($toolSlug) < 1 || strlen($toolSlug) > 191 || ! preg_match('/^[A-Za-z0-9._-]+$/', $toolSlug)) {
            throw new RuntimeApiException('INVALID_LAUNCH_REQUEST', 422, 'Writer and tool identifiers must be valid bounded identifiers.');
        }

        $profile = $toolProfiles->resolve($toolSlug, $writerId);
        if (array_key_exists('launch_url', $request->all())) {
            $suppliedLaunchUrl = trim((string) $request->input('launch_url', ''));
            if (! hash_equals($profile['launchUrl'], $suppliedLaunchUrl)) {
                throw new RuntimeApiException('LAUNCH_URL_OVERRIDE_FORBIDDEN', 422, 'Launch URL is controlled by the configured tool profile.');
            }
        }

        // Fail before Chromium is created if the viewer cannot issue a usable grant.
        $viewerGrants->assertConfigured();
        $result = $sessions->create($writerId, $toolSlug, $profile['launchUrl']);

        return response()->json($result, $result['reused'] ? 200 : 201);
    }

    public function show(Request $request, string $session, SessionManager $sessions): JsonResponse
    {
        return response()->json($sessions->status($session, $this->writerId($request)));
    }

    public function heartbeat(Request $request, string $session, SessionManager $sessions): JsonResponse
    {
        return response()->json($sessions->heartbeat($session, $this->writerId($request)));
    }

    public function activity(Request $request, string $session, SessionManager $sessions): JsonResponse
    {
        return response()->json($sessions->activity($session, $this->writerId($request)));
    }

    public function viewerGrant(Request $request, string $session, SessionManager $sessions): JsonResponse
    {
        return response()->json($sessions->viewerGrant($session, $this->writerId($request)));
    }

    public function destroy(Request $request, string $session, SessionManager $sessions): JsonResponse
    {
        return response()->json($sessions->close($session, $this->writerId($request)));
    }

    private function writerId(Request $request): string
    {
        $writerId = trim((string) $request->attributes->get('authenticated_writer_id', ''));
        if ($writerId === '') {
            throw new RuntimeApiException('AUTH_REQUIRED', 401, 'Authenticated writer identity is missing.');
        }

        return $writerId;
    }
}
