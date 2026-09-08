<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('runtime_request_limits', function (Blueprint $table): void {
            $table->string('key', 64)->primary();
            $table->timestamp('window_started_at')->index();
            $table->unsignedInteger('hits');
            $table->timestamp('updated_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('runtime_request_limits');
    }
};
