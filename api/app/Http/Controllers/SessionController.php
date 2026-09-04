<?php

namespace App\Http\Controllers;

use App\Exceptions\RuntimeApiException;
use App\Services\SessionManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class SessionController
{
    public function store(Request $request, SessionManager $sessions): JsonResponse
    {
        $writerId = $this->writerId($request);
        $bodyWriterId = trim((string) $request->input('writer_id', ''));
        $toolSlug = trim((string) $request->input('tool_slug', ''));
        $launchUrl = trim((string) $request->input('launch_url', ''));

        if ($bodyWriterId === '' || ! hash_equals($writerId, $bodyWriterId)) {
            throw new RuntimeApiException('WRITER_ID_MISMATCH', 403, 'The signed writer identity does not match the launch request.');
        }
        if (strlen($writerId) > 191 || strlen($toolSlug) < 1 || strlen($toolSlug) > 191 || ! preg_match('/^[A-Za-z0-9._-]+$/', $toolSlug)) {
            throw new RuntimeApiException('INVALID_LAUNCH_REQUEST', 422, 'Writer and tool identifiers must be valid bounded identifiers.');
        }
        if (! $this->validLaunchUrl($launchUrl)) {
            throw new RuntimeApiException('INVALID_LAUNCH_URL', 422, 'Launch URL must use http, https, or data:text/html.');
        }

        $result = $sessions->create($writerId, $toolSlug, $launchUrl);

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

    private function validLaunchUrl(string $value): bool
    {
        if ($value === '') {
            return false;
        }
        if (str_starts_with(strtolower($value), 'data:text/html')) {
            return true;
        }
        if (filter_var($value, FILTER_VALIDATE_URL) === false) {
            return false;
        }

        return in_array(strtolower((string) parse_url($value, PHP_URL_SCHEME)), ['http', 'https'], true);
    }
}
