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

    public function create(
        string $writerId,
        string $toolSlug,
        string $launchUrl,
        ?array $browserState = null,
        array $browserStatePolicy = [],
        array $authentication = [],
    ): array {
        return $this->withCreationLock(function () use ($writerId, $toolSlug, $launchUrl, $browserState, $browserStatePolicy, $authentication): array {
            $maxSessions = $this->assertCapacityConfiguration();
            $lifecycle = $this->lifecycleConfiguration();
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

                $reused = $this->withSessionLock($existing->id, function () use ($existing, $workerSessions): ?array {
                    $fresh = BrowserSession::query()->find($existing->id);
                    if ($fresh === null || ! in_array($fresh->status, self::OPEN_STATUSES, true)) {
                        return null;
                    }

                    if ($fresh->worker_session_id !== null && isset($workerSessions[$fresh->worker_session_id])) {
                        $fresh->forceFill(['last_heartbeat_at' => now()])->save();

                        return $this->present($fresh->fresh(), true);
                    }

                    $this->markFailed($fresh, 'WORKER_SESSION_MISSING', 'The tracked browser session is no longer active in the worker.');

                    return null;
                });

                if ($reused !== null) {
                    return $reused;
                }
            }

            if (($browserStatePolicy['required'] ?? false) === true && $browserState === null) {
                throw new RuntimeApiException('BROWSER_STATE_REQUIRED', 422, 'This configured tool requires authorized shared browser state for a new session.');
            }

            $open = $this->openSessionCount();
            $occupancy = $open + $this->untrackedWorkerSessionCount($workerSessions);
            if ($occupancy >= $maxSessions) {
                throw new RuntimeApiException('CAPACITY_FULL', 429, 'Self Hosted browser capacity is temporarily full.');
            }

            $createdAt = now();
            $session = BrowserSession::query()->create([
                'id' => (string) Str::uuid(),
                'writer_id' => $writerId,
                'tool_slug' => $toolSlug,
                'launch_url' => $this->safeLaunchUrlForRecord($launchUrl),
                'status' => 'starting',
                'last_heartbeat_at' => $createdAt,
                'last_activity_at' => $createdAt,
                'lease_expires_at' => $createdAt->copy()->addSeconds($lifecycle['leaseSeconds']),
            ]);

            try {
                $workerStatus = $this->worker->start($launchUrl, $browserState, $browserStatePolicy, $authentication);
            } catch (RuntimeApiException $exception) {
                $failureCode = in_array($exception->errorCode, ['BROWSER_STATE_INVALID', 'BROWSER_STATE_TOO_LARGE', 'TOOL_AUTH_NOT_VERIFIED'], true)
                    ? $exception->errorCode
                    : 'WORKER_START_FAILED';
                $this->markFailed($session, $failureCode, 'The worker could not create a verified browser session.');
                throw $exception;
            }

            if (($workerStatus['active'] ?? false) !== true || ! is_string($workerStatus['sessionId'] ?? null) || $workerStatus['sessionId'] === '') {
                $this->markFailed($session, 'WORKER_PROTOCOL_ERROR', 'The worker did not return an active session identifier.');
                throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker did not create a valid session.');
            }

            $workerSessionId = $workerStatus['sessionId'];
            if (($authentication['required'] ?? false) === true
                && ($workerStatus['authentication']['verified'] ?? false) !== true) {
                try {
                    $stop = $this->worker->stop($workerSessionId);
                    $this->assertCleanStop($stop, $workerSessionId);
                } catch (RuntimeApiException $cleanupException) {
                    $this->markFailed($session, 'WORKER_CLEANUP_FAILED', 'The unverified browser session could not be proven cleanly terminated.');
                    throw $cleanupException;
                }
                $this->markFailed($session, 'TOOL_AUTH_NOT_VERIFIED', 'The configured tool did not reach its authenticated state.');
                throw new RuntimeApiException('TOOL_AUTH_NOT_VERIFIED', 409, 'The configured tool did not reach its authenticated state.');
            }

            $alreadyTracked = BrowserSession::query()
                ->where('worker_session_id', $workerSessionId)
                ->where('id', '!=', $session->id)
                ->exists();
            if ($alreadyTracked) {
                $this->markFailed($session, 'WORKER_SESSION_COLLISION', 'The worker returned a browser session identifier already tracked by another record.');
                throw new RuntimeApiException('WORKER_PROTOCOL_ERROR', 502, 'The browser worker returned a duplicate session identifier.');
            }

            $activatedAt = now();
            $session->forceFill([
                'status' => 'active',
                'worker_session_id' => $workerSessionId,
                'started_at' => $activatedAt,
                'lease_expires_at' => $activatedAt->copy()->addSeconds($lifecycle['leaseSeconds']),
                'failure_code' => null,
                'failure_detail' => null,
            ])->save();

            return $this->present($session->fresh(), false);
        });
    }

    public function status(string $sessionId, string $writerId): array
    {
        return $this->withSessionLock($sessionId, function () use ($sessionId, $writerId): array {
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
        });
    }

    public function heartbeat(string $sessionId, string $writerId): array
    {
        return $this->withSessionLock($sessionId, function () use ($sessionId, $writerId): array {
            $session = $this->ownedActive($sessionId, $writerId);
            $session->forceFill(['last_heartbeat_at' => now()])->save();

            return $this->present($session->fresh(), false, false);
        });
    }

    public function activity(string $sessionId, string $writerId): array
    {
        return $this->withSessionLock($sessionId, function () use ($sessionId, $writerId): array {
            $session = $this->ownedActive($sessionId, $writerId);
            $lifecycle = $this->lifecycleConfiguration();
            $activityAt = now();
            $session->forceFill([
                'last_activity_at' => $activityAt,
                'lease_expires_at' => $activityAt->copy()->addSeconds($lifecycle['leaseSeconds']),
            ])->save();

            return $this->present($session->fresh(), false, false);
        });
    }

    public function viewerGrant(string $sessionId, string $writerId): array
    {
        return $this->withSessionLock($sessionId, function () use ($sessionId, $writerId): array {
            $session = $this->ownedActive($sessionId, $writerId);
            if ($session->worker_session_id === null) {
                throw new RuntimeApiException('SESSION_NOT_VIEWABLE', 409, 'The browser session is not ready for viewing.');
            }

            $session->forceFill(['last_heartbeat_at' => now()])->save();

            return [
                'sessionId' => $session->id,
                'viewerGrant' => $this->viewerGrants->issue($session->worker_session_id, $writerId),
            ];
        });
    }

    public function close(string $sessionId, string $writerId): array
    {
        return $this->withSessionLock($sessionId, function () use ($sessionId, $writerId): array {
            $session = $this->owned($sessionId, $writerId);
            if (in_array($session->status, self::TERMINAL_STATUSES, true)) {
                return $this->present($session, false, false);
            }

            $this->terminateSession($session, 'explicit_close', true);

            return $this->present($session->fresh(), false, false);
        });
    }

    public function reap(): array
    {
        $lifecycle = $this->lifecycleConfiguration();
        $now = now();

        return $this->withCreationLock(function () use ($lifecycle, $now): array {
            $summary = [
                'phase' => 6,
                'status' => 'ok',
                'workerAvailable' => true,
                'examinedSessions' => 0,
                'expiredSessions' => 0,
                'failedMissingWorkerSessions' => 0,
                'closedInterruptedSessions' => 0,
                'staleStartingSessions' => 0,
                'leasesInitialized' => 0,
                'orphanWorkerSessionsStopped' => 0,
                'orphanCleanupDeferred' => 0,
                'errors' => [],
            ];

            try {
                $workerSessions = $this->workerSessionIndex();
            } catch (RuntimeApiException $exception) {
                $summary['status'] = 'deferred';
                $summary['workerAvailable'] = false;
                $summary['deferredReason'] = $exception->errorCode;

                return $summary;
            }

            $openIds = BrowserSession::query()
                ->whereIn('status', self::OPEN_STATUSES)
                ->orderBy('created_at')
                ->pluck('id')
                ->all();

            foreach ($openIds as $sessionId) {
                $summary['examinedSessions']++;

                try {
                    $this->withSessionLock((string) $sessionId, function () use ($sessionId, $lifecycle, $now, &$workerSessions, &$summary): void {
                        $session = BrowserSession::query()->find($sessionId);
                        if ($session === null || ! in_array($session->status, self::OPEN_STATUSES, true)) {
                            return;
                        }

                        if ($session->status === 'starting') {
                            $createdAt = $session->created_at ?? $now;
                            if ($createdAt->copy()->addSeconds($lifecycle['startupGraceSeconds'])->lte($now)) {
                                $this->markFailed($session, 'STARTUP_TIMEOUT', 'The browser session did not finish starting before the startup grace period elapsed.');
                                $summary['staleStartingSessions']++;
                            }
                            return;
                        }

                        if ($session->status === 'closing') {
                            $workerSessionId = $session->worker_session_id;
                            if ($workerSessionId === null || ! isset($workerSessions[$workerSessionId])) {
                                $this->markClosed($session, $session->termination_reason ?: 'reconciled_close');
                                $summary['closedInterruptedSessions']++;
                                return;
                            }

                            $this->terminateSession($session, $session->termination_reason ?: 'reconciled_close', true);
                            unset($workerSessions[$workerSessionId]);
                            $summary['closedInterruptedSessions']++;
                            return;
                        }

                        if ($session->worker_session_id === null || ! isset($workerSessions[$session->worker_session_id])) {
                            $this->markFailed($session, 'WORKER_SESSION_MISSING', 'The tracked browser session is no longer active in the worker.');
                            $summary['failedMissingWorkerSessions']++;
                            return;
                        }

                        if ($session->lease_expires_at === null) {
                            $session->forceFill([
                                'lease_expires_at' => $now->copy()->addSeconds($lifecycle['leaseSeconds']),
                            ])->save();
                            $session = $session->fresh();
                            $summary['leasesInitialized']++;
                        }

                        $reason = $this->expirationReason($session, $now, $lifecycle);
                        if ($reason === null) {
                            return;
                        }

                        $workerSessionId = $session->worker_session_id;
                        $this->terminateSession($session, $reason, false);
                        if ($workerSessionId !== null) {
                            unset($workerSessions[$workerSessionId]);
                        }
                        $summary['expiredSessions']++;
                    });
                } catch (RuntimeApiException $exception) {
                    $summary['status'] = 'error';
                    $summary['errors'][] = [
                        'sessionId' => (string) $sessionId,
                        'code' => $exception->errorCode,
                    ];
                }
            }

            $trackedWorkerIds = BrowserSession::query()
                ->whereIn('status', self::OPEN_STATUSES)
                ->whereNotNull('worker_session_id')
                ->pluck('worker_session_id')
                ->map(fn ($value) => (string) $value)
                ->all();
            $tracked = array_fill_keys($trackedWorkerIds, true);

            $recentStartingExists = BrowserSession::query()
                ->where('status', 'starting')
                ->where('created_at', '>', $now->copy()->subSeconds($lifecycle['startupGraceSeconds']))
                ->exists();

            foreach (array_keys($workerSessions) as $workerSessionId) {
                if (isset($tracked[$workerSessionId])) {
                    continue;
                }

                if ($recentStartingExists) {
                    $summary['orphanCleanupDeferred']++;
                    continue;
                }

                try {
                    $stop = $this->worker->stop($workerSessionId);
                    $this->assertCleanStop($stop, $workerSessionId);
                    $summary['orphanWorkerSessionsStopped']++;
                } catch (RuntimeApiException $exception) {
                    if (in_array($exception->errorCode, ['WORKER_SESSION_MISSING', 'WORKER_SESSION_GONE'], true)) {
                        continue;
                    }
                    $summary['status'] = 'error';
                    $summary['errors'][] = [
                        'workerSessionId' => $workerSessionId,
                        'code' => $exception->errorCode,
                    ];
                }
            }

            return $summary;
        });
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
                && ($health['phase'] ?? null) === 6
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
            'phase' => 6,
            'configuredMaxSessions' => $configured,
            'effectiveMaxSessions' => $configurationValid && $workerCapacityMatches ? $configured : 0,
            'openSessions' => $open,
            'workerActiveSessions' => $workerActive,
            'availableSlots' => $available,
            'workerHealthy' => $workerHealthy,
            'configurationValid' => $configurationValid && $workerCapacityMatches,
        ];
    }

    public function lifecycleConfiguration(): array
    {
        $values = [
            'leaseSeconds' => (int) config('browser.session_lease_seconds', 5400),
            'idleTimeoutSeconds' => (int) config('browser.session_idle_timeout_seconds', 900),
            'disconnectGraceSeconds' => (int) config('browser.session_disconnect_grace_seconds', 180),
            'startupGraceSeconds' => (int) config('browser.session_startup_grace_seconds', 30),
            'reaperIntervalSeconds' => (int) config('browser.session_reaper_interval_seconds', 30),
        ];

        if ($values['leaseSeconds'] < 1 || $values['leaseSeconds'] > 86400
            || $values['idleTimeoutSeconds'] < 1 || $values['idleTimeoutSeconds'] > 86400
            || $values['disconnectGraceSeconds'] < 1 || $values['disconnectGraceSeconds'] > 3600
            || $values['startupGraceSeconds'] < 1 || $values['startupGraceSeconds'] > 3600
            || $values['reaperIntervalSeconds'] < 1 || $values['reaperIntervalSeconds'] > 300) {
            throw new RuntimeApiException('LIFECYCLE_CONFIG_INVALID', 503, 'Lifecycle timeout configuration is invalid.');
        }

        return $values;
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
            'leaseExpiresAt' => optional($session->lease_expires_at)->toIso8601String(),
            'closedAt' => optional($session->closed_at)->toIso8601String(),
            'terminationReason' => $session->termination_reason,
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

    private function ownedActive(string $sessionId, string $writerId): BrowserSession
    {
        $session = $this->owned($sessionId, $writerId);
        if ($session->status !== 'active') {
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

    private function expirationReason(BrowserSession $session, $now, array $lifecycle): ?string
    {
        $activityAt = $session->last_activity_at ?? $session->started_at ?? $session->created_at;
        $heartbeatAt = $session->last_heartbeat_at ?? $session->started_at ?? $session->created_at;

        $deadlines = [];
        if ($session->lease_expires_at !== null) {
            $deadlines['lease_expired'] = $session->lease_expires_at;
        }
        if ($activityAt !== null) {
            $deadlines['idle_timeout'] = $activityAt->copy()->addSeconds($lifecycle['idleTimeoutSeconds']);
        }
        if ($heartbeatAt !== null) {
            $deadlines['disconnect_timeout'] = $heartbeatAt->copy()->addSeconds($lifecycle['disconnectGraceSeconds']);
        }

        $expired = [];
        foreach ($deadlines as $reason => $deadline) {
            if ($deadline->lte($now)) {
                $expired[$reason] = $deadline->getTimestamp();
            }
        }
        if ($expired === []) {
            return null;
        }

        asort($expired, SORT_NUMERIC);

        return (string) array_key_first($expired);
    }

    private function terminateSession(BrowserSession $session, string $reason, bool $preserveClosingOnFailure): void
    {
        if (in_array($session->status, self::TERMINAL_STATUSES, true)) {
            return;
        }

        $previousStatus = $session->status;
        $previousReason = $session->termination_reason;
        $workerSessionId = $session->worker_session_id;

        if ($workerSessionId !== null) {
            try {
                $workerStatus = $this->worker->status($workerSessionId);
                if (($workerStatus['sessionId'] ?? null) !== $workerSessionId) {
                    $this->markFailed($session, 'WORKER_SESSION_MISMATCH', 'The worker returned an unexpected browser session identity.');
                    throw new RuntimeApiException('WORKER_SESSION_MISMATCH', 409, 'The browser worker returned a different session; no other browser was terminated.');
                }
            } catch (RuntimeApiException $exception) {
                if (in_array($exception->errorCode, ['WORKER_SESSION_MISSING', 'WORKER_SESSION_GONE'], true)) {
                    $this->markClosed($session, $reason);
                    return;
                }
                throw $exception;
            }

            $session->forceFill([
                'status' => 'closing',
                'termination_reason' => $reason,
            ])->save();

            try {
                $stop = $this->worker->stop($workerSessionId);
                $this->assertCleanStop($stop, $workerSessionId);
            } catch (RuntimeApiException $exception) {
                if (in_array($exception->errorCode, ['WORKER_SESSION_MISSING', 'WORKER_SESSION_GONE'], true)) {
                    $this->markClosed($session, $reason);
                    return;
                }

                if (in_array($exception->errorCode, ['WORKER_CLEANUP_FAILED', 'WORKER_SESSION_MISMATCH'], true)) {
                    $this->markFailed($session, $exception->errorCode, 'The browser worker could not prove exact, complete cleanup for this session.');
                    throw $exception;
                }

                if (! $preserveClosingOnFailure) {
                    $session->forceFill([
                        'status' => $previousStatus,
                        'termination_reason' => $previousReason,
                    ])->save();
                }
                throw $exception;
            }
        }

        $this->markClosed($session, $reason);
    }

    private function assertCleanStop(array $stop, string $expectedWorkerSessionId): void
    {
        if (($stop['sessionId'] ?? $expectedWorkerSessionId) !== $expectedWorkerSessionId) {
            throw new RuntimeApiException('WORKER_SESSION_MISMATCH', 409, 'The browser worker stopped an unexpected session.');
        }

        $cleanup = is_array($stop['cleanup'] ?? null) ? $stop['cleanup'] : [];
        $clean = ($cleanup['rootExited'] ?? false) === true
            && empty($cleanup['orphanPids'] ?? [])
            && empty($cleanup['zombiePids'] ?? []);
        if (! $clean) {
            throw new RuntimeApiException('WORKER_CLEANUP_FAILED', 502, 'The browser session did not clean up completely.');
        }
    }

    private function markClosed(BrowserSession $session, string $reason): void
    {
        $session->forceFill([
            'status' => 'closed',
            'closed_at' => now(),
            'termination_reason' => $reason,
            'failure_code' => null,
            'failure_detail' => null,
        ])->save();
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

    private function assertCapacityConfiguration(): int
    {
        $configured = (int) config('browser.max_browser_sessions', 1);
        if ($configured < 2 || $configured > self::MAX_SUPPORTED_SESSIONS) {
            throw new RuntimeApiException('CAPACITY_CONFIG_INVALID', 503, 'MAX_BROWSER_SESSIONS must be between 2 and 15 for the multi-writer runtime.');
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

    private function withCreationLock(callable $callback): mixed
    {
        return $this->withFileLock(storage_path('data/phase6-session-create.lock'), $callback);
    }

    private function withSessionLock(string $sessionId, callable $callback): mixed
    {
        if (! preg_match('/^[0-9a-f-]{36}$/i', $sessionId)) {
            throw new RuntimeApiException('SESSION_NOT_FOUND', 404, 'Browser session not found.');
        }

        $directory = storage_path('data/session-locks');
        if (! is_dir($directory) && ! mkdir($directory, 0775, true) && ! is_dir($directory)) {
            throw new RuntimeApiException('SESSION_LOCK_FAILED', 503, 'Unable to create the browser session lock directory.');
        }

        return $this->withFileLock($directory.'/'.$sessionId.'.lock', $callback);
    }

    private function withFileLock(string $path, callable $callback): mixed
    {
        $handle = fopen($path, 'c');
        if ($handle === false) {
            throw new RuntimeApiException('SESSION_LOCK_FAILED', 503, 'Unable to acquire the browser session lifecycle lock.');
        }

        try {
            if (! flock($handle, LOCK_EX)) {
                throw new RuntimeApiException('SESSION_LOCK_FAILED', 503, 'Unable to acquire the browser session lifecycle lock.');
            }

            return $callback();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
