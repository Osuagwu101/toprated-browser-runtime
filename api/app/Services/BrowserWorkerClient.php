<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

final class BrowserWorkerClient
{
    private function url(string $path): string
    {
        return rtrim((string) config('browser.worker_url'), '/').'/'.ltrim($path, '/');
    }

    public function health(): array
    {
        return $this->request('GET', '/health', null, false);
    }

    public function sessions(): array
    {
        return $this->request('GET', '/browser/sessions');
    }

    public function status(string $workerSessionId): array
    {
        return $this->request('GET', '/browser/sessions/'.rawurlencode($workerSessionId));
    }

    public function start(?string $launchUrl): array
    {
        return $this->request('POST', '/browser/sessions', $launchUrl === null ? [] : ['url' => $launchUrl]);
    }

    public function stop(string $workerSessionId): array
    {
        return $this->request('DELETE', '/browser/sessions/'.rawurlencode($workerSessionId));
    }

    private function request(string $method, string $path, ?array $payload = null, bool $authenticateControl = true): array
    {
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
        } catch (ConnectionException) {
            throw new RuntimeApiException('WORKER_UNAVAILABLE', 503, 'The browser worker is unavailable.');
        }

        if (! $response->successful()) {
            [$code, $status] = match ($response->status()) {
                401 => ['WORKER_AUTH_FAILED', 502],
                404 => ['WORKER_SESSION_MISSING', 404],
                410 => ['WORKER_SESSION_GONE', 410],
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
