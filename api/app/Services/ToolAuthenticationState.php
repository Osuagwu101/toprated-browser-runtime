<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

final class ToolAuthenticationState
{
    private const READY = 'ready';
    private const REAUTH_REQUIRED = 'reauth_required';

    public function assertLaunchAllowed(string $toolSlug, array $authentication, string $accountScope = 'legacy'): void
    {
        if (($authentication['required'] ?? false) !== true) {
            return;
        }

        $state = $this->status($toolSlug, $accountScope);
        if ($state['status'] === self::REAUTH_REQUIRED) {
            throw $this->reauthRequired();
        }
    }

    public function requireReauthentication(string $toolSlug, string $reasonCode, string $accountScope = 'legacy'): array
    {
        $now = now();
        $existing = DB::table('tool_auth_states')->where('tool_slug', $toolSlug)->where('account_scope', $accountScope)->first();

        DB::table('tool_auth_states')->updateOrInsert(
            ['tool_slug' => $toolSlug, 'account_scope' => $accountScope],
            [
                'status' => self::REAUTH_REQUIRED,
                'reason_code' => $this->boundedReason($reasonCode),
                'invalidated_at' => $now,
                'restored_at' => null,
                'verified_at' => $existing?->verified_at,
                'created_at' => $existing?->created_at ?? $now,
                'updated_at' => $now,
            ],
        );

        return $this->status($toolSlug, $accountScope);
    }

    public function markRestored(string $toolSlug, string $accountScope = 'legacy'): array
    {
        $now = now();
        $existing = DB::table('tool_auth_states')->where('tool_slug', $toolSlug)->where('account_scope', $accountScope)->first();

        DB::table('tool_auth_states')->updateOrInsert(
            ['tool_slug' => $toolSlug, 'account_scope' => $accountScope],
            [
                'status' => self::READY,
                'reason_code' => null,
                'invalidated_at' => null,
                'restored_at' => $now,
                'verified_at' => $existing?->verified_at,
                'created_at' => $existing?->created_at ?? $now,
                'updated_at' => $now,
            ],
        );

        return $this->status($toolSlug, $accountScope);
    }

    public function markVerified(string $toolSlug, string $accountScope = 'legacy'): array
    {
        $now = now();
        $existing = DB::table('tool_auth_states')->where('tool_slug', $toolSlug)->where('account_scope', $accountScope)->first();

        DB::table('tool_auth_states')->updateOrInsert(
            ['tool_slug' => $toolSlug, 'account_scope' => $accountScope],
            [
                'status' => self::READY,
                'reason_code' => null,
                'invalidated_at' => null,
                'restored_at' => $existing?->restored_at,
                'verified_at' => $now,
                'created_at' => $existing?->created_at ?? $now,
                'updated_at' => $now,
            ],
        );

        return $this->status($toolSlug, $accountScope);
    }

    public function status(string $toolSlug, string $accountScope = 'legacy'): array
    {
        $row = DB::table('tool_auth_states')->where('tool_slug', $toolSlug)->where('account_scope', $accountScope)->first();
        if ($row === null) {
            return [
                'toolSlug' => $toolSlug,
                'status' => self::READY,
                'adminActionRequired' => false,
                'reasonCode' => null,
                'invalidatedAt' => null,
                'restoredAt' => null,
                'verifiedAt' => null,
            ];
        }

        $status = (string) $row->status;
        if (! in_array($status, [self::READY, self::REAUTH_REQUIRED], true)) {
            throw new RuntimeApiException('TOOL_AUTH_STATE_INVALID', 503, 'Tool authentication state is invalid.');
        }

        return [
            'toolSlug' => $toolSlug,
            'status' => $status,
            'adminActionRequired' => $status === self::REAUTH_REQUIRED,
            'reasonCode' => $row->reason_code === null ? null : (string) $row->reason_code,
            'invalidatedAt' => $this->timestamp($row->invalidated_at),
            'restoredAt' => $this->timestamp($row->restored_at),
            'verifiedAt' => $this->timestamp($row->verified_at),
        ];
    }

    public function reauthRequired(): RuntimeApiException
    {
        return new RuntimeApiException(
            'TOOL_REAUTH_REQUIRED',
            423,
            'This tool is temporarily unavailable while an administrator refreshes authentication.',
        );
    }

    private function boundedReason(string $reasonCode): string
    {
        $reason = trim($reasonCode);
        if ($reason === '' || strlen($reason) > 64 || ! preg_match('/^[A-Z0-9_]+$/', $reason)) {
            return 'TOOL_AUTH_NOT_VERIFIED';
        }

        return $reason;
    }

    private function timestamp(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return Carbon::parse((string) $value)->toIso8601String();
    }
}
