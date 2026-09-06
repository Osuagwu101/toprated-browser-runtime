<?php

use App\Exceptions\RuntimeApiException;
use App\Http\Middleware\VerifyOperatorRequest;
use App\Http\Middleware\VerifyServiceRequest;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'service.auth' => VerifyServiceRequest::class,
            'operator.auth' => VerifyOperatorRequest::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (RuntimeApiException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'status' => 'error',
                'code' => $exception->errorCode,
                'message' => $exception->getMessage(),
            ], $exception->statusCode);
        });
    })
    ->create();
