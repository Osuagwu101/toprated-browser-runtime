<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('browser_sessions', function (Blueprint $table): void {
            $table->string('id', 36)->primary();
            $table->string('writer_id', 191)->index();
            $table->string('tool_slug', 191)->index();
            $table->text('launch_url')->nullable();
            $table->string('status', 32)->index();
            $table->string('worker_session_id', 36)->nullable()->unique();
            $table->timestamp('last_heartbeat_at')->nullable();
            $table->timestamp('last_activity_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->string('termination_reason', 64)->nullable();
            $table->string('failure_code', 64)->nullable();
            $table->text('failure_detail')->nullable();
            $table->timestamps();
            $table->index(['writer_id', 'status']);
        });

        Schema::create('service_request_nonces', function (Blueprint $table): void {
            $table->string('nonce', 128)->primary();
            $table->timestamp('seen_at')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_request_nonces');
        Schema::dropIfExists('browser_sessions');
    }
};
