<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;

final class ViewerGrantService
{
    public function assertConfigured(): void
    {
        $secret = (string) config('browser.viewer_signing_secret', '');
        if (strlen($secret) < 32) {
            throw new RuntimeApiException('VIEWER_AUTH_MISCONFIGURED', 503, 'Viewer authorization is not configured.');
        }

        $ttl = (int) config('browser.viewer_token_ttl_seconds', 300);
        if ($ttl < 1 || $ttl > 900) {
            throw new RuntimeApiException('VIEWER_TTL_INVALID', 503, 'Viewer token lifetime is invalid.');
        }

        $baseUrl = rtrim((string) config('browser.viewer_public_base_url', ''), '/');
        $scheme = strtolower((string) parse_url($baseUrl, PHP_URL_SCHEME));
        if ($baseUrl === '' || filter_var($baseUrl, FILTER_VALIDATE_URL) === false || ! in_array($scheme, ['http', 'https'], true)) {
            throw new RuntimeApiException('VIEWER_URL_INVALID', 503, 'Viewer public base URL is invalid.');
        }
    }

    public function issue(string $workerSessionId, string $writerId): array
    {
        $this->assertConfigured();

        $secret = (string) config('browser.viewer_signing_secret');
        $ttl = (int) config('browser.viewer_token_ttl_seconds', 300);
        $baseUrl = rtrim((string) config('browser.viewer_public_base_url'), '/');
        $now = time();
        $payload = [
            'v' => 1,
            'sid' => $workerSessionId,
            'wid' => $writerId,
            'iat' => $now,
            'exp' => $now + $ttl,
            'jti' => $this->base64Url(random_bytes(12)),
        ];

        $encoded = $this->base64Url(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        $signature = $this->base64Url(hash_hmac('sha256', $encoded, $secret, true));
        $token = $encoded.'.'.$signature;

        return [
            'url' => $baseUrl.'/viewer/'.rawurlencode($workerSessionId).'#'.rawurlencode($token),
            'expiresAt' => gmdate('c', $payload['exp']),
            'tokenTransport' => 'url-fragment-to-bearer',
            'rawCdpExposed' => false,
        ];
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
