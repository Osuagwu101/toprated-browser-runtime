<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

final class BrowserWorkerClient
{
    private const READ_CONNECTION_ATTEMPTS = 4;
    private const READ_CONNECTION_RETRY_DELAY_MICROSECONDS = 100000;

    private function url(string $path): string
    {
        return rtrim((string) config('browser.worker_url'), '/').'/'.ltrim($path, '/');
    }

    public function health(): array
    {
        return $this->request('GET', '/health', null, false, true);
    }

    public function sessions(): array
    {
        return $this->request('GET', '/browser/sessions', null, true, true);
    }

    public function status(string $workerSessionId): array
    {
        return $this->request('GET', '/browser/sessions/'.rawurlencode($workerSessionId), null, true, true);
    }

    public function start(
        string $launchUrl,
        ?array $browserState = null,
        array $browserStatePolicy = [],
        array $authentication = [],
    ): array {
        $payload = [
            'url' => $launchUrl,
            'browserStatePolicy' => $browserStatePolicy,
            'authentication' => $authentication,
        ];
        if ($browserState !== null) {
            $payload['browserState'] = $browserState;
        }

        return $this->request('POST', '/browser/sessions', $payload);
    }

    public function stop(string $workerSessionId): array
    {
        return $this->request('DELETE', '/browser/sessions/'.rawurlencode($workerSessionId));
    }

    private function request(
        string $method,
        string $path,
        ?array $payload = null,
        bool $authenticateControl = true,
        bool $retryConnection = false,
    ): array {
        $attempts = $retryConnection ? self::READ_CONNECTION_ATTEMPTS : 1;
        $response = null;

        for ($attempt = 1; $attempt <= $attempts; $attempt++) {
            $pending = Http::acceptJson()->timeout(15);
            if ($authenticateControl) {
                $secret = (string) config('browser.worker_control_secret', '');
                if (strlen($secret) < 32) {
                    throw new RuntimeApiException('WORKER_AUTH_MISCONFIGURED', 503, 'Browser worker control authentication is not configured.');
                }
                $pending = $pending->withHeaders(['X-Toprated-Worker-Secret' => $secret]);
            }

            try {
                $response = $payload === null
                    ? $pending->send($method, $this->url($path))
                    : $pending->asJson()->send($method, $this->url($path), ['json' => $payload]);
                break;
            } catch (ConnectionException) {
                if ($attempt === $attempts) {
                    throw new RuntimeApiException('WORKER_UNAVAILABLE', 503, 'The browser worker is unavailable.');
                }

                usleep(self::READ_CONNECTION_RETRY_DELAY_MICROSECONDS);
            }
        }

        if ($response === null) {
            throw new RuntimeApiException('WORKER_UNAVAILABLE', 503, 'The browser worker is unavailable.');
        }

        if (! $response->successful()) {
            $workerCode = is_string($response->json('code')) ? $response->json('code') : null;
            if ($workerCode === 'BROWSER_STATE_INVALID') {
                throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'The browser worker rejected the authorized browser state.');
            }
            if ($workerCode === 'AUTHENTICATION_NOT_VERIFIED') {
                throw new RuntimeApiException('TOOL_AUTH_NOT_VERIFIED', 409, 'The configured tool did not reach its authenticated state.');
            }

            [$code, $status] = match ($response->status()) {
                401 => ['WORKER_AUTH_FAILED', 502],
                404 => ['WORKER_SESSION_MISSING', 404],
                410 => ['WORKER_SESSION_GONE', 410],
                413 => ['BROWSER_STATE_TOO_LARGE', 413],
                422 => ['WORKER_REQUEST_INVALID', 502],
                429 => ['WORKER_CAPACITY_FULL', 429],
                409 => ['WORKER_BUSY', 409],
                default => ['WORKER_ERROR', 502],
            };
            throw new RuntimeApiException($code, $status, 'The browser worker rejected the lifecycle operation.');
        }

        $data = $response->json();
        if (! is_array($data)) {
            throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker returned an invalid response.');
        }

        return $data;
    }
}
