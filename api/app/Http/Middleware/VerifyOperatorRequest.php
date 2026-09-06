<?php

namespace App\Http\Middleware;

use App\Exceptions\RuntimeApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class VerifyOperatorRequest
{
    public function handle(Request $request, Closure $next): Response
    {
        $secret = (string) config('browser.operator_auth_secret', '');
        if (strlen($secret) < 32) {
            throw new RuntimeApiException('OPERATOR_AUTH_MISCONFIGURED', 503, 'Runtime operator authentication is not configured.');
        }

        $supplied = (string) $request->header('X-Toprated-Operator-Secret', '');
        if ($supplied === '' || ! hash_equals($secret, $supplied)) {
            throw new RuntimeApiException('OPERATOR_AUTH_REQUIRED', 401, 'Administrator authorization is required.');
        }

        $request->attributes->set('authenticated_runtime_operator', true);

        return $next($request);
    }
}
