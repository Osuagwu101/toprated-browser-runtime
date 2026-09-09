<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('browser_sessions', function (Blueprint $table): void {
            $table->string('session_kind', 32)->default('writer')->index()->after('tool_slug');
        });

        Schema::create('tool_authorized_states', function (Blueprint $table): void {
            $table->string('tool_slug', 191)->primary();
            $table->longText('encrypted_payload');
            $table->unsignedBigInteger('state_version');
            $table->timestamp('captured_at')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('invalidated_at')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tool_authorized_states');
        Schema::table('browser_sessions', function (Blueprint $table): void {
            $table->dropIndex(['session_kind']);
            $table->dropColumn('session_kind');
        });
    }
};
