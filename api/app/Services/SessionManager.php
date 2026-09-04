<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use App\Models\BrowserSession;
use Illuminate\Support\Str;

final class SessionManager
{
    private const OPEN_STATUSES = ['starting', 'active', 'closing'];
    private const TERMINAL_STATUSES = ['closed', 'failed'];

    public function __construct(
        private readonly BrowserWorkerClient $worker,
        private readonly ViewerGrantService $viewerGrants,
    ) {
    }

    public function create(string $writerId, string $toolSlug, string $launchUrl): array
    {
        return $this->withCreationLock(function () use ($writerId, $toolSlug, $launchUrl): array {
            $this->assertPhase4CapacityConfiguration();

            $existing = BrowserSession::query()
                ->where('writer_id', $writerId)
                ->whereIn('status', self::OPEN_STATUSES)
                ->latest('created_at')
                ->first();

            if ($existing !== null) {
                if ($existing->tool_slug !== $toolSlug) {
                    throw new RuntimeApiException('WRITER_SESSION_ACTIVE', 409, 'The writer already owns an active browser session for another tool.');
                }

                $workerStatus = $this->worker->status();
                if (($workerStatus['active'] ?? false) === true && ($workerStatus['sessionId'] ?? null) === $existing->worker_session_id) {
                    return $this->present($existing, true);
                }

                $this->markFailed($existing, 'WORKER_SESSION_MISSING', 'The tracked browser session is no longer active in the worker.');
            }

            $workerStatus = $this->worker->status();
            if (($workerStatus['active'] ?? false) === true) {
                $tracked = BrowserSession::query()
                    ->where('worker_session_id', (string) ($workerStatus['sessionId'] ?? ''))
                    ->whereIn('status', self::OPEN_STATUSES)
                    ->first();

                if ($tracked === null) {
                    throw new RuntimeApiException('WORKER_BUSY_UNTRACKED', 503, 'The browser worker is occupied by an untracked session.');
                }
                if ($tracked->writer_id !== $writerId) {
                    throw new RuntimeApiException('CAPACITY_FULL', 429, 'Self Hosted browser capacity is temporarily full.');
                }
                if ($tracked->tool_slug !== $toolSlug) {
                    throw new RuntimeApiException('WRITER_SESSION_ACTIVE', 409, 'The writer already owns an active browser session for another tool.');
                }

                return $this->present($tracked, true);
            }

            if ($this->openSessionCount() >= 1) {
                throw new RuntimeApiException('CAPACITY_FULL', 429, 'Self Hosted browser capacity is temporarily full.');
            }

            $session = BrowserSession::query()->create([
                'id' => (string) Str::uuid(),
                'writer_id' => $writerId,
                'tool_slug' => $toolSlug,
                'launch_url' => $this->safeLaunchUrlForRecord($launchUrl),
                'status' => 'starting',
                'last_heartbeat_at' => now(),
                'last_activity_at' => now(),
            ]);

            try {
                $workerStatus = $this->worker->start($launchUrl);
            } catch (RuntimeApiException $exception) {
                $this->markFailed($session, 'WORKER_START_FAILED', 'The worker could not start the browser session.');
                throw $exception;
            }

            if (($workerStatus['active'] ?? false) !== true || ! is_string($workerStatus['sessionId'] ?? null) || $workerStatus['sessionId'] === '') {
                $this->markFailed($session, 'WORKER_PROTOCOL_ERROR', 'The worker did not return an active session identifier.');
                throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker did not create a valid session.');
            }

            $session->forceFill([
                'status' => 'active',
                'worker_session_id' => $workerStatus['sessionId'],
                'started_at' => now(),
                'failure_code' => null,
                'failure_detail' => null,
            ])->save();

            return $this->present($session->fresh(), false);
        });
    }

    public function status(string $sessionId, string $writerId): array
    {
        $session = $this->owned($sessionId, $writerId);
        if ($session->status === 'active') {
            $workerStatus = $this->worker->status();
            if (($workerStatus['active'] ?? false) !== true) {
                $this->markFailed($session, 'WORKER_SESSION_MISSING', 'The tracked browser session is no longer active in the worker.');
                $session = $session->fresh();
            } elseif (($workerStatus['sessionId'] ?? null) !== $session->worker_session_id) {
                $this->markFailed($session, 'WORKER_SESSION_MISMATCH', 'The worker is running a different browser session.');
                $session = $session->fresh();
            }
        }

        return $this->present($session, false, false);
    }

    public function heartbeat(string $sessionId, string $writerId): array
    {
        $session = $this->ownedOpen($sessionId, $writerId);
        $session->forceFill(['last_heartbeat_at' => now()])->save();

        return $this->present($session->fresh(), false, false);
    }

    public function activity(string $sessionId, string $writerId): array
    {
        $session = $this->ownedOpen($sessionId, $writerId);
        $session->forceFill(['last_activity_at' => now()])->save();

        return $this->present($session->fresh(), false, false);
    }

    public function viewerGrant(string $sessionId, string $writerId): array
    {
        $session = $this->ownedOpen($sessionId, $writerId);
        if ($session->status !== 'active' || $session->worker_session_id === null) {
            throw new RuntimeApiException('SESSION_NOT_VIEWABLE', 409, 'The browser session is not ready for viewing.');
        }

        return [
            'sessionId' => $session->id,
            'viewerGrant' => $this->viewerGrants->issue($session->worker_session_id, $writerId),
        ];
    }

    public function close(string $sessionId, string $writerId): array
    {
        $session = $this->owned($sessionId, $writerId);
        if (in_array($session->status, self::TERMINAL_STATUSES, true)) {
            return $this->present($session, false, false);
        }

        $session->forceFill(['status' => 'closing'])->save();
        $workerStatus = $this->worker->status();

        if (($workerStatus['active'] ?? false) === true) {
            if (($workerStatus['sessionId'] ?? null) !== $session->worker_session_id) {
                $this->markFailed($session, 'WORKER_SESSION_MISMATCH', 'The worker is running a different browser session.');
                throw new RuntimeApiException('WORKER_SESSION_MISMATCH', 409, 'The browser worker is running a different session; it was not terminated.');
            }

            $stop = $this->worker->stop();
            $cleanup = is_array($stop['cleanup'] ?? null) ? $stop['cleanup'] : [];
            $clean = ($cleanup['rootExited'] ?? false) === true
                && empty($cleanup['orphanPids'] ?? [])
                && empty($cleanup['zombiePids'] ?? []);
            if (! $clean) {
                $this->markFailed($session, 'WORKER_CLEANUP_FAILED', 'The browser worker reported incomplete process cleanup.');
                throw new RuntimeApiException('WORKER_CLEANUP_FAILED', 502, 'The browser session did not clean up completely.');
            }
        }

        $session->forceFill([
            'status' => 'closed',
            'closed_at' => now(),
            'termination_reason' => 'explicit_close',
        ])->save();

        return $this->present($session->fresh(), false, false);
    }

    public function capacity(): array
    {
        $configured = (int) config('browser.max_browser_sessions', 1);
        $workerHealthy = false;
        $workerActive = false;

        try {
            $health = $this->worker->health();
            $workerHealthy = ($health['status'] ?? null) === 'ok';
            $status = $this->worker->status();
            $workerActive = ($status['active'] ?? false) === true;
        } catch (RuntimeApiException) {
            $workerHealthy = false;
        }

        $open = $this->openSessionCount();
        $configurationValid = $configured === 1;
        $available = $configurationValid && $workerHealthy && ! $workerActive && $open === 0 ? 1 : 0;

        return [
            'phase' => 4,
            'configuredMaxSessions' => $configured,
            'effectiveMaxSessions' => 1,
            'openSessions' => $open,
            'availableSlots' => $available,
            'workerHealthy' => $workerHealthy,
            'workerActive' => $workerActive,
            'configurationValid' => $configurationValid,
        ];
    }

    private function present(BrowserSession $session, bool $reused, bool $includeViewerGrant = true): array
    {
        $viewerGrant = null;
        if ($includeViewerGrant && $session->status === 'active' && $session->worker_session_id !== null) {
            $viewerGrant = $this->viewerGrants->issue($session->worker_session_id, $session->writer_id);
        }

        return [
            'sessionId' => $session->id,
            'status' => $session->status,
            'writerId' => $session->writer_id,
            'toolSlug' => $session->tool_slug,
            'reused' => $reused,
            'startedAt' => optional($session->started_at)->toIso8601String(),
            'lastHeartbeatAt' => optional($session->last_heartbeat_at)->toIso8601String(),
            'lastActivityAt' => optional($session->last_activity_at)->toIso8601String(),
            'closedAt' => optional($session->closed_at)->toIso8601String(),
            'failureCode' => $session->failure_code,
            'viewerGrant' => $viewerGrant,
        ];
    }

    private function owned(string $sessionId, string $writerId): BrowserSession
    {
        $session = BrowserSession::query()->find($sessionId);
        if ($session === null) {
            throw new RuntimeApiException('SESSION_NOT_FOUND', 404, 'Browser session not found.');
        }
        if (! hash_equals($session->writer_id, $writerId)) {
            throw new RuntimeApiException('SESSION_FORBIDDEN', 403, 'This writer does not own the browser session.');
        }

        return $session;
    }

    private function ownedOpen(string $sessionId, string $writerId): BrowserSession
    {
        $session = $this->owned($sessionId, $writerId);
        if (! in_array($session->status, self::OPEN_STATUSES, true)) {
            throw new RuntimeApiException('SESSION_NOT_ACTIVE', 409, 'The browser session is no longer active.');
        }

        return $session;
    }

    private function openSessionCount(): int
    {
        return BrowserSession::query()->whereIn('status', self::OPEN_STATUSES)->count();
    }

    private function markFailed(BrowserSession $session, string $code, string $detail): void
    {
        $session->forceFill([
            'status' => 'failed',
            'closed_at' => now(),
            'termination_reason' => 'failure',
            'failure_code' => $code,
            'failure_detail' => $detail,
        ])->save();
    }

    private function assertPhase4CapacityConfiguration(): void
    {
        if ((int) config('browser.max_browser_sessions', 1) !== 1) {
            throw new RuntimeApiException('CAPACITY_CONFIG_INVALID', 503, 'Phase 4 requires MAX_BROWSER_SESSIONS=1 until Phase 5 multi-session isolation is implemented.');
        }
    }

    private function safeLaunchUrlForRecord(string $launchUrl): string
    {
        if (str_starts_with(strtolower($launchUrl), 'data:text/html')) {
            return 'data:text/html';
        }

        $parts = parse_url($launchUrl);
        if (! is_array($parts)) {
            return '[invalid]';
        }

        $scheme = isset($parts['scheme']) ? $parts['scheme'].'://' : '';
        $host = $parts['host'] ?? '';
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';
        $path = $parts['path'] ?? '/';

        return $scheme.$host.$port.$path;
    }

    private function withCreationLock(callable $callback): array
    {
        $path = storage_path('framework/phase4-session-create.lock');
        $handle = fopen($path, 'c');
        if ($handle === false) {
            throw new RuntimeApiException('SESSION_LOCK_FAILED', 503, 'Unable to acquire the browser session creation lock.');
        }

        try {
            if (! flock($handle, LOCK_EX)) {
                throw new RuntimeApiException('SESSION_LOCK_FAILED', 503, 'Unable to acquire the browser session creation lock.');
            }

            return $callback();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
