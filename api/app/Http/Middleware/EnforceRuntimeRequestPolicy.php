<?php

namespace App\Http\Middleware;

use App\Exceptions\RuntimeApiException;
use App\Services\RuntimeRequestRateLimiter;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use JsonException;
use Symfony\Component\HttpFoundation\Response;

final class EnforceRuntimeRequestPolicy
{
    public function __construct(private readonly RuntimeRequestRateLimiter $rateLimiter)
    {
    }

    public function handle(Request $request, Closure $next, string $scope): Response
    {
        if (! in_array($scope, ['service', 'operator'], true)) {
            throw new RuntimeApiException('REQUEST_POLICY_MISCONFIGURED', 503, 'Runtime request policy is not configured.');
        }

        if ($request->getQueryString() !== null) {
            throw new RuntimeApiException('REQUEST_QUERY_FORBIDDEN', 400, 'Protected runtime routes do not accept query parameters.');
        }

        $content = $request->getContent();
        $maxBytes = max(4096, (int) config('browser.api_request_max_bytes', 327680));
        if (strlen($content) > $maxBytes) {
            throw new RuntimeApiException('REQUEST_TOO_LARGE', 413, 'Runtime request body is too large.');
        }

        if (trim($content) !== '') {
            if (in_array(strtoupper($request->method()), ['GET', 'DELETE'], true)) {
                throw new RuntimeApiException('REQUEST_BODY_FORBIDDEN', 400, 'This runtime method does not accept a request body.');
            }

            $contentType = strtolower(trim((string) $request->header('Content-Type', '')));
            if (! preg_match('/^application\/json(?:\s*;|$)/', $contentType)) {
                throw new RuntimeApiException('UNSUPPORTED_MEDIA_TYPE', 415, 'Runtime request bodies must use application/json.');
            }

            try {
                $decoded = json_decode($content, false, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                throw new RuntimeApiException('MALFORMED_JSON', 400, 'Runtime request body must be valid JSON.');
            }
            if (! is_object($decoded)) {
                throw new RuntimeApiException('MALFORMED_REQUEST', 400, 'Runtime request body must be a JSON object.');
            }
        }

        $limit = max(1, (int) config("browser.{$scope}_rate_limit_per_minute", $scope === 'operator' ? 60 : 600));
        $subject = (string) ($request->ip() ?: 'unknown');
        $rate = $this->rateLimiter->hit($scope, $subject, $limit);
        if (! $rate['allowed']) {
            return new JsonResponse([
                'status' => 'error',
                'code' => 'RATE_LIMITED',
                'message' => 'Runtime request rate limit exceeded.',
            ], 429, [
                'Retry-After' => (string) $rate['retryAfter'],
                'Cache-Control' => 'no-store, max-age=0',
            ]);
        }

        return $next($request);
    }
}
