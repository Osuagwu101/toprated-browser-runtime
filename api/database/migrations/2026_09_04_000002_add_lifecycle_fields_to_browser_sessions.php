<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('browser_sessions', function (Blueprint $table): void {
            $table->timestamp('lease_expires_at')->nullable()->index()->after('last_activity_at');
        });
    }

    public function down(): void
    {
        Schema::table('browser_sessions', function (Blueprint $table): void {
            $table->dropColumn('lease_expires_at');
        });
    }
};
