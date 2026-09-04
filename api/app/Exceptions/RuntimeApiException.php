<?php

namespace App\Exceptions;

use RuntimeException;

final class RuntimeApiException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        public readonly int $statusCode,
        string $message,
    ) {
        parent::__construct($message);
    }
}
