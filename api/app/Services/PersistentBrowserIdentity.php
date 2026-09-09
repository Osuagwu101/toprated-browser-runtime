<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use Illuminate\Encryption\Encrypter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;
use JsonException;
use Throwable;

final class PersistentBrowserIdentity
{
    public function configuration(): array
    {
        $encoded = trim((string) config('browser.identity_encryption_key', ''));
        $key = base64_decode($encoded, true);
        if (! is_string($key) || strlen($key) !== 32) {
            throw new RuntimeApiException(
                'BROWSER_IDENTITY_KEY_INVALID',
                503,
                'Persistent browser identity encryption is not configured.',
            );
        }

        return [
            'key' => $key,
            'cipher' => 'AES-256-GCM',
        ];
    }

    public function save(string $toolSlug, array $state, ?string $capturedAt = null): array
    {
        try {
            $plaintext = json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (JsonException) {
            throw new RuntimeApiException('BROWSER_IDENTITY_INVALID', 422, 'Captured browser identity is not valid JSON data.');
        }

        $now = now();
        $existing = DB::table('tool_browser_identities')->where('tool_slug', $toolSlug)->first();
        $version = ((int) ($existing?->version ?? 0)) + 1;
        try {
            $captureTime = $capturedAt === null ? $now : Carbon::parse($capturedAt);
        } catch (Throwable) {
            $captureTime = $now;
        }
        $encrypted = $this->encrypter()->encryptString($plaintext);

        DB::table('tool_browser_identities')->updateOrInsert(
            ['tool_slug' => $toolSlug],
            [
                'encrypted_payload' => $encrypted,
                'payload_fingerprint' => hash('sha256', $plaintext),
                'version' => $version,
                'captured_at' => $captureTime,
                'approved_at' => $now,
                'created_at' => $existing?->created_at ?? $now,
                'updated_at' => $now,
            ],
        );

        return $this->metadata($toolSlug);
    }

    public function load(string $toolSlug): ?array
    {
        $row = DB::table('tool_browser_identities')->where('tool_slug', $toolSlug)->first();
        if ($row === null) {
            return null;
        }

        try {
            $plaintext = $this->encrypter()->decryptString((string) $row->encrypted_payload);
            if (! hash_equals((string) $row->payload_fingerprint, hash('sha256', $plaintext))) {
                throw new RuntimeApiException('BROWSER_IDENTITY_UNAVAILABLE', 503, 'The approved browser identity failed integrity validation.');
            }
            $state = json_decode($plaintext, true, 32, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new RuntimeApiException(
                'BROWSER_IDENTITY_UNAVAILABLE',
                503,
                'The approved browser identity could not be opened safely.',
            );
        }

        if (! is_array($state) || array_is_list($state)) {
            throw new RuntimeApiException('BROWSER_IDENTITY_UNAVAILABLE', 503, 'The approved browser identity is invalid.');
        }

        return $state;
    }

    public function metadata(string $toolSlug): array
    {
        $row = DB::table('tool_browser_identities')->where('tool_slug', $toolSlug)->first();
        if ($row === null) {
            return [
                'available' => false,
                'version' => null,
                'capturedAt' => null,
                'approvedAt' => null,
            ];
        }

        return [
            'available' => true,
            'version' => (int) $row->version,
            'capturedAt' => $this->timestamp($row->captured_at),
            'approvedAt' => $this->timestamp($row->approved_at),
        ];
    }

    private function encrypter(): Encrypter
    {
        $configuration = $this->configuration();

        return new Encrypter($configuration['key'], $configuration['cipher']);
    }

    private function timestamp(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return now()->parse((string) $value)->toIso8601String();
    }
}
