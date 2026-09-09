<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tool_browser_identities', function (Blueprint $table): void {
            $table->string('tool_slug', 191)->primary();
            $table->longText('encrypted_payload');
            $table->char('payload_fingerprint', 64);
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamp('captured_at');
            $table->timestamp('approved_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tool_browser_identities');
    }
};
