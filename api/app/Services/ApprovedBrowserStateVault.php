<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use JsonException;

final class ApprovedBrowserStateVault
{
    private const SCHEMA_VERSION = 1;

    public function store(string $toolSlug, array $state): array
    {
        $now = now();

        try {
            $plaintext = json_encode([
                'schemaVersion' => self::SCHEMA_VERSION,
                'toolSlug' => $toolSlug,
                'state' => $state,
            ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
            $encrypted = Crypt::encryptString($plaintext);
        } catch (JsonException) {
            throw new RuntimeApiException('APPROVED_STATE_INVALID', 500, 'Approved browser state could not be serialized.');
        }

        return DB::transaction(function () use ($toolSlug, $encrypted, $now): array {
            $existing = DB::table('tool_authorized_states')->where('tool_slug', $toolSlug)->lockForUpdate()->first();
            $version = ((int) ($existing?->state_version ?? 0)) + 1;

            DB::table('tool_authorized_states')->updateOrInsert(
                ['tool_slug' => $toolSlug],
                [
                    'encrypted_payload' => $encrypted,
                    'state_version' => $version,
                    'captured_at' => $now,
                    'approved_at' => $now,
                    'invalidated_at' => null,
                    'created_at' => $existing?->created_at ?? $now,
                    'updated_at' => $now,
                ],
            );

            return $this->metadata($toolSlug);
        });
    }

    public function load(string $toolSlug): ?array
    {
        $row = DB::table('tool_authorized_states')
            ->where('tool_slug', $toolSlug)
            ->whereNull('invalidated_at')
            ->first();
        if ($row === null) {
            return null;
        }

        try {
            $plaintext = Crypt::decryptString((string) $row->encrypted_payload);
            $envelope = json_decode($plaintext, true, 32, JSON_THROW_ON_ERROR);
        } catch (DecryptException|JsonException) {
            throw new RuntimeApiException('APPROVED_STATE_UNAVAILABLE', 503, 'Approved browser state could not be opened safely.');
        }

        if (! is_array($envelope)
            || ($envelope['schemaVersion'] ?? null) !== self::SCHEMA_VERSION
            || ! is_string($envelope['toolSlug'] ?? null)
            || ! hash_equals($toolSlug, $envelope['toolSlug'])
            || ! is_array($envelope['state'] ?? null)
            || array_is_list($envelope['state'])) {
            throw new RuntimeApiException('APPROVED_STATE_INVALID', 503, 'Approved browser state envelope is invalid.');
        }

        return $envelope['state'];
    }

    public function invalidate(string $toolSlug): void
    {
        DB::table('tool_authorized_states')
            ->where('tool_slug', $toolSlug)
            ->whereNull('invalidated_at')
            ->update(['invalidated_at' => now(), 'updated_at' => now()]);
    }

    public function metadata(string $toolSlug): array
    {
        $row = DB::table('tool_authorized_states')->where('tool_slug', $toolSlug)->first();

        return [
            'available' => $row !== null && $row->invalidated_at === null,
            'stateVersion' => $row === null ? null : (int) $row->state_version,
            'capturedAt' => $this->timestamp($row?->captured_at),
            'approvedAt' => $this->timestamp($row?->approved_at),
            'invalidatedAt' => $this->timestamp($row?->invalidated_at),
            'encryptedAtRest' => true,
        ];
    }

    private function timestamp(mixed $value): ?string
    {
        return $value === null || $value === '' ? null : \Illuminate\Support\Carbon::parse((string) $value)->toIso8601String();
    }
}
