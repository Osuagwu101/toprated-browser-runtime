<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

final class BrowserSession extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'writer_id',
        'tool_slug',
        'launch_url',
        'status',
        'worker_session_id',
        'last_heartbeat_at',
        'last_activity_at',
        'started_at',
        'closed_at',
        'termination_reason',
        'failure_code',
        'failure_detail',
    ];

    protected function casts(): array
    {
        return [
            'last_heartbeat_at' => 'datetime',
            'last_activity_at' => 'datetime',
            'started_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }
}
