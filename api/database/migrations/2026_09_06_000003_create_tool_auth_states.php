<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tool_auth_states', function (Blueprint $table): void {
            $table->string('tool_slug', 191)->primary();
            $table->string('status', 32)->index();
            $table->string('reason_code', 64)->nullable();
            $table->timestamp('invalidated_at')->nullable();
            $table->timestamp('restored_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tool_auth_states');
    }
};
