<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use App\Models\BrowserSession;
use Illuminate\Support\Str;

final class SessionManager
{
    private const OPEN_STATUSES = ['starting', 'active', 'closing'];
    private const TERMINAL_STATUSES = ['closed', 'failed'];
    private const MAX_SUPPORTED_SESSIONS = 15;

    public function __construct(
        private readonly BrowserWorkerClient $worker,
        private readonly ViewerGrantService $viewerGrants,
    ) {
    }

    public function create(string $writerId, string $toolSlug, string $launchUrl): array
    {
        return $this->withCreationLock(function () use ($writerId, $toolSlug, $launchUrl): array {
            $maxSessions = $this->assertPhase5CapacityConfiguration();
            $workerSessions = $this->workerSessionIndex();

            $existing = BrowserSession::query()
                ->where('writer_id', $writerId)
                ->whereIn('status', self::OPEN_STATUSES)
                ->latest('created_at')
                ->first();

            if ($existing !== null) {
                if ($existing->tool_slug !== $toolSlug) {
                    throw new RuntimeApiException('WRITER_SESSION_ACTIVE', 409, 'The writer already owns an active browser session for another tool.');
                }

                if ($existing->worker_session_id !== null && isset($workerSessions[$existing->worker_session_id])) {
                    return $this->present($existing, true);
                }

                $this->markFailed($existing, 'WORKER_SESSION_MISSING', 'The tracked browser session is no longer active in the worker.');
            }

            $open = $this->openSessionCount();
            $occupancy = $open + $this->untrackedWorkerSessionCount($workerSessions);
            if ($occupancy >= $maxSessions) {
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

            $workerSessionId = $workerStatus['sessionId'];
            $alreadyTracked = BrowserSession::query()
                ->where('worker_session_id', $workerSessionId)
                ->where('id', '!=', $session->id)
                ->exists();
            if ($alreadyTracked) {
                // Never terminate a worker session whose ownership is ambiguous. Phase 6 will reconcile it.
                $this->markFailed($session, 'WORKER_SESSION_COLLISION', 'The worker returned a browser session identifier already tracked by another record.');
                throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker returned a duplicate session identifier.');
            }

            $session->forceFill([
                'status' => 'active',
                'worker_session_id' => $workerSessionId,
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
        if ($session->status === 'active' && $session->worker_session_id !== null) {
            try {
                $workerStatus = $this->worker->status($session->worker_session_id);
                if (($workerStatus['active'] ?? false) !== true || ($workerStatus['sessionId'] ?? null) !== $session->worker_session_id) {
                    $this->markFailed($session, 'WORKER_SESSION_MISMATCH', 'The worker returned an unexpected browser session identity.');
                    $session = $session->fresh();
                }
            } catch (RuntimeApiException $exception) {
                if (in_array($exception->errorCode, ['WORKER_SESSION_MISSING', 'WORKER_SESSION_GONE'], true)) {
                    $this->markFailed($session, 'WORKER_SESSION_MISSING', 'The tracked browser session is no longer active in the worker.');
                    $session = $session->fresh();
                } else {
                    throw $exception;
                }
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

        $workerSessionId = $session->worker_session_id;
        $session->forceFill(['status' => 'closing'])->save();

        if ($workerSessionId !== null) {
            try {
                $workerStatus = $this->worker->status($workerSessionId);
                if (($workerStatus['sessionId'] ?? null) !== $workerSessionId) {
                    $this->markFailed($session, 'WORKER_SESSION_MISMATCH', 'The worker returned an unexpected browser session identity.');
                    throw new RuntimeApiException('WORKER_SESSION_MISMATCH', 409, 'The browser worker returned a different session; no other browser was terminated.');
                }

                $stop = $this->worker->stop($workerSessionId);
                if (($stop['sessionId'] ?? $workerSessionId) !== $workerSessionId) {
                    $this->markFailed($session, 'WORKER_SESSION_MISMATCH', 'The worker stopped an unexpected browser session identity.');
                    throw new RuntimeApiException('WORKER_SESSION_MISMATCH', 409, 'The browser worker stopped an unexpected session.');
                }
                $cleanup = is_array($stop['cleanup'] ?? null) ? $stop['cleanup'] : [];
                $clean = ($cleanup['rootExited'] ?? false) === true
                    && empty($cleanup['orphanPids'] ?? [])
                    && empty($cleanup['zombiePids'] ?? []);
                if (! $clean) {
                    $this->markFailed($session, 'WORKER_CLEANUP_FAILED', 'The browser worker reported incomplete process cleanup.');
                    throw new RuntimeApiException('WORKER_CLEANUP_FAILED', 502, 'The browser session did not clean up completely.');
                }
            } catch (RuntimeApiException $exception) {
                if (! in_array($exception->errorCode, ['WORKER_SESSION_MISSING', 'WORKER_SESSION_GONE'], true)) {
                    throw $exception;
                }
                // The exact worker session is already gone. Closing the record is safe and does not affect other sessions.
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
        $configurationValid = $configured >= 2 && $configured <= self::MAX_SUPPORTED_SESSIONS;
        $workerHealthy = false;
        $workerActive = 0;
        $workerCapacityMatches = false;

        try {
            $health = $this->worker->health();
            $workerCapacityMatches = (int) ($health['capacity']['maxSessions'] ?? 0) === $configured
                && ($health['capacity']['configurationValid'] ?? false) === true;
            $workerHealthy = ($health['status'] ?? null) === 'ok'
                && ($health['phase'] ?? null) === 5
                && ($health['lifecycleOwner'] ?? null) === 'laravel'
                && $workerCapacityMatches;
        } catch (RuntimeApiException) {
            $workerHealthy = false;
        }

        $open = $this->openSessionCount();
        $workerSessions = [];
        if ($workerHealthy) {
            try {
                $workerSessions = $this->workerSessionIndex();
                $workerActive = count($workerSessions);
            } catch (RuntimeApiException) {
                $workerHealthy = false;
                $workerActive = 0;
            }
        }
        $occupancy = $open + ($workerHealthy ? $this->untrackedWorkerSessionCount($workerSessions) : 0);
        $available = $configurationValid && $workerHealthy ? max(0, $configured - $occupancy) : 0;

        return [
            'phase' => 5,
            'configuredMaxSessions' => $configured,
            'effectiveMaxSessions' => $configurationValid && $workerCapacityMatches ? $configured : 0,
            'openSessions' => $open,
            'workerActiveSessions' => $workerActive,
            'availableSlots' => $available,
            'workerHealthy' => $workerHealthy,
            'configurationValid' => $configurationValid && $workerCapacityMatches,
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

    private function workerSessionIndex(): array
    {
        $payload = $this->worker->sessions();
        if (! is_array($payload['sessions'] ?? null)) {
            throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker did not return a session list.');
        }

        $index = [];
        foreach ($payload['sessions'] as $workerSession) {
            if (! is_array($workerSession) || ($workerSession['active'] ?? false) !== true || ! is_string($workerSession['sessionId'] ?? null) || $workerSession['sessionId'] === '') {
                throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker returned an invalid session entry.');
            }
            if (isset($index[$workerSession['sessionId']])) {
                throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker returned a duplicate session entry.');
            }
            $index[$workerSession['sessionId']] = $workerSession;
        }

        return $index;
    }

    private function untrackedWorkerSessionCount(array $workerSessions): int
    {
        if ($workerSessions === []) {
            return 0;
        }

        $trackedIds = BrowserSession::query()
            ->whereIn('status', self::OPEN_STATUSES)
            ->whereNotNull('worker_session_id')
            ->pluck('worker_session_id')
            ->all();
        $tracked = array_fill_keys(array_map('strval', $trackedIds), true);

        $untracked = 0;
        foreach (array_keys($workerSessions) as $workerSessionId) {
            if (! isset($tracked[$workerSessionId])) {
                $untracked++;
            }
        }

        return $untracked;
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

    private function assertPhase5CapacityConfiguration(): int
    {
        $configured = (int) config('browser.max_browser_sessions', 1);
        if ($configured < 2 || $configured > self::MAX_SUPPORTED_SESSIONS) {
            throw new RuntimeApiException('CAPACITY_CONFIG_INVALID', 503, 'Phase 5 requires MAX_BROWSER_SESSIONS between 2 and 15.');
        }

        return $configured;
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
        $path = storage_path('framework/phase5-session-create.lock');
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
