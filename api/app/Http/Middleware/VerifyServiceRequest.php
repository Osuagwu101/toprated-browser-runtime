<?php

namespace App\Http\Middleware;

use App\Exceptions\RuntimeApiException;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class VerifyServiceRequest
{
    public function handle(Request $request, Closure $next): Response
    {
        $secret = (string) config('browser.service_auth_secret', '');
        if (strlen($secret) < 32) {
            throw new RuntimeApiException('SERVICE_AUTH_MISCONFIGURED', 503, 'Runtime service authentication is not configured.');
        }

        $timestampHeader = (string) $request->header('X-Toprated-Timestamp', '');
        $nonce = (string) $request->header('X-Toprated-Nonce', '');
        $signature = strtolower((string) $request->header('X-Toprated-Signature', ''));
        $writerId = trim((string) $request->header('X-Toprated-Writer-Id', ''));

        if (! ctype_digit($timestampHeader) || $nonce === '' || $signature === '' || $writerId === '') {
            throw new RuntimeApiException('AUTH_REQUIRED', 401, 'A signed service request is required.');
        }
        if (! preg_match('/^[A-Za-z0-9_-]{16,128}$/', $nonce)) {
            throw new RuntimeApiException('AUTH_INVALID_NONCE', 401, 'The service request nonce is invalid.');
        }
        if (! preg_match('/^[a-f0-9]{64}$/', $signature)) {
            throw new RuntimeApiException('AUTH_INVALID_SIGNATURE', 401, 'The service request signature is invalid.');
        }

        $timestamp = (int) $timestampHeader;
        $maxSkew = max(30, (int) config('browser.service_auth_max_skew_seconds', 300));
        if (abs(time() - $timestamp) > $maxSkew) {
            throw new RuntimeApiException('AUTH_CLOCK_SKEW', 401, 'The signed service request is outside the allowed time window.');
        }

        $bodyHash = hash('sha256', $request->getContent());
        $canonical = implode("\n", [
            strtoupper($request->method()),
            $request->getPathInfo(),
            (string) $timestamp,
            $nonce,
            $writerId,
            $bodyHash,
        ]);
        $expected = hash_hmac('sha256', $canonical, $secret);
        if (! hash_equals($expected, $signature)) {
            throw new RuntimeApiException('AUTH_INVALID_SIGNATURE', 401, 'The service request signature is invalid.');
        }

        DB::table('service_request_nonces')
            ->where('seen_at', '<', now()->subSeconds($maxSkew * 2))
            ->delete();

        try {
            DB::table('service_request_nonces')->insert([
                'nonce' => $nonce,
                'seen_at' => now(),
            ]);
        } catch (QueryException $exception) {
            if ((string) $exception->getCode() === '23000') {
                throw new RuntimeApiException('AUTH_REPLAY', 409, 'The signed service request has already been used.');
            }
            throw $exception;
        }

        $request->attributes->set('authenticated_writer_id', $writerId);

        return $next($request);
    }
}
