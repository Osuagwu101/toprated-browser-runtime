<?php

use App\Services\SessionManager;
use Illuminate\Support\Facades\Artisan;

Artisan::command('browser:sessions:reap', function (): int {
    /** @var SessionManager $sessions */
    $sessions = app(SessionManager::class);
    $result = $sessions->reap();
    $this->line(json_encode($result, JSON_UNESCAPED_SLASHES));

    return ($result['status'] ?? 'error') === 'error' ? 1 : 0;
})->purpose('Enforce browser session lease/idle/disconnect lifecycle and reconcile worker state.');
