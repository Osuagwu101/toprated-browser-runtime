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
        return $this->request('GET', '/health');
    }

    public function status(): array
    {
        return $this->request('GET', '/browser/status');
    }

    public function start(?string $launchUrl): array
    {
        return $this->request('POST', '/browser/start', $launchUrl === null ? [] : ['url' => $launchUrl]);
    }

    public function stop(): array
    {
        return $this->request('POST', '/browser/stop', []);
    }

    private function request(string $method, string $path, ?array $payload = null): array
    {
        try {
            $pending = Http::acceptJson()->timeout(15);
            $response = $payload === null
                ? $pending->send($method, $this->url($path))
                : $pending->asJson()->send($method, $this->url($path), ['json' => $payload]);
        } catch (ConnectionException) {
            throw new RuntimeApiException('WORKER_UNAVAILABLE', 503, 'The browser worker is unavailable.');
        }

        if (! $response->successful()) {
            $code = $response->status() === 409 ? 'WORKER_BUSY' : 'WORKER_ERROR';
            $status = $response->status() === 409 ? 409 : 502;
            throw new RuntimeApiException($code, $status, 'The browser worker rejected the lifecycle operation.');
        }

        $data = $response->json();
        if (! is_array($data)) {
            throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker returned an invalid response.');
        }

        return $data;
    }
}
