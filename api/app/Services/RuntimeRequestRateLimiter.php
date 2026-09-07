<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

final class RuntimeRequestRateLimiter
{
    public function hit(string $scope, string $subject, int $limit, int $windowSeconds = 60): array
    {
        $limit = max(1, $limit);
        $windowSeconds = max(1, $windowSeconds);
        $key = hash('sha256', $scope."\n".$subject);
        $now = now();

        return DB::transaction(function () use ($key, $limit, $windowSeconds, $now): array {
            DB::table('runtime_request_limits')
                ->where('window_started_at', '<', $now->copy()->subSeconds($windowSeconds * 2))
                ->delete();

            DB::table('runtime_request_limits')->insertOrIgnore([
                'key' => $key,
                'window_started_at' => $now,
                'hits' => 0,
                'updated_at' => $now,
            ]);
            $row = DB::table('runtime_request_limits')->where('key', $key)->lockForUpdate()->first();
            if ($row === null) {
                throw new \RuntimeException('Runtime request rate-limit state could not be created.');
            }

            $windowStart = \Illuminate\Support\Carbon::parse($row->window_started_at);
            $elapsed = $windowStart->diffInSeconds($now, false);
            if ($elapsed < 0 || $elapsed >= $windowSeconds) {
                DB::table('runtime_request_limits')->where('key', $key)->update([
                    'window_started_at' => $now,
                    'hits' => 1,
                    'updated_at' => $now,
                ]);

                return ['allowed' => true, 'remaining' => $limit - 1, 'retryAfter' => $windowSeconds];
            }

            $hits = (int) $row->hits + 1;
            DB::table('runtime_request_limits')->where('key', $key)->update([
                'hits' => $hits,
                'updated_at' => $now,
            ]);

            return [
                'allowed' => $hits <= $limit,
                'remaining' => max(0, $limit - $hits),
                'retryAfter' => max(1, (int) ceil($windowSeconds - $elapsed)),
            ];
        }, 3);
    }
}
