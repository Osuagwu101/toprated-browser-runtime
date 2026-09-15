<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('browser_sessions', function (Blueprint $table): void {
            $table->string('account_scope', 191)->default('legacy')->index();
        });

        Schema::create('tool_auth_states_scoped', function (Blueprint $table): void {
            $table->string('tool_slug', 191);
            $table->string('account_scope', 191)->default('legacy');
            $table->string('status', 32)->index();
            $table->string('reason_code', 64)->nullable();
            $table->timestamp('invalidated_at')->nullable();
            $table->timestamp('restored_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
            $table->primary(['tool_slug', 'account_scope']);
        });
        foreach (DB::table('tool_auth_states')->get() as $row) {
            DB::table('tool_auth_states_scoped')->insert([
                'tool_slug' => $row->tool_slug,
                'account_scope' => 'legacy',
                'status' => $row->status,
                'reason_code' => $row->reason_code,
                'invalidated_at' => $row->invalidated_at,
                'restored_at' => $row->restored_at,
                'verified_at' => $row->verified_at,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }
        Schema::drop('tool_auth_states');
        Schema::rename('tool_auth_states_scoped', 'tool_auth_states');

        Schema::create('tool_browser_identities_scoped', function (Blueprint $table): void {
            $table->string('tool_slug', 191);
            $table->string('account_scope', 191)->default('legacy');
            $table->longText('encrypted_payload');
            $table->char('payload_fingerprint', 64);
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamp('captured_at');
            $table->timestamp('approved_at');
            $table->timestamps();
            $table->primary(['tool_slug', 'account_scope']);
        });
        foreach (DB::table('tool_browser_identities')->get() as $row) {
            DB::table('tool_browser_identities_scoped')->insert([
                'tool_slug' => $row->tool_slug,
                'account_scope' => 'legacy',
                'encrypted_payload' => $row->encrypted_payload,
                'payload_fingerprint' => $row->payload_fingerprint,
                'version' => $row->version,
                'captured_at' => $row->captured_at,
                'approved_at' => $row->approved_at,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }
        Schema::drop('tool_browser_identities');
        Schema::rename('tool_browser_identities_scoped', 'tool_browser_identities');
    }

    public function down(): void
    {
        Schema::create('tool_auth_states_legacy', function (Blueprint $table): void {
            $table->string('tool_slug', 191)->primary();
            $table->string('status', 32)->index();
            $table->string('reason_code', 64)->nullable();
            $table->timestamp('invalidated_at')->nullable();
            $table->timestamp('restored_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });
        foreach (DB::table('tool_auth_states')->where('account_scope', 'legacy')->get() as $row) {
            DB::table('tool_auth_states_legacy')->insert([
                'tool_slug' => $row->tool_slug,
                'status' => $row->status,
                'reason_code' => $row->reason_code,
                'invalidated_at' => $row->invalidated_at,
                'restored_at' => $row->restored_at,
                'verified_at' => $row->verified_at,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }
        Schema::drop('tool_auth_states');
        Schema::rename('tool_auth_states_legacy', 'tool_auth_states');

        Schema::create('tool_browser_identities_legacy', function (Blueprint $table): void {
            $table->string('tool_slug', 191)->primary();
            $table->longText('encrypted_payload');
            $table->char('payload_fingerprint', 64);
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamp('captured_at');
            $table->timestamp('approved_at');
            $table->timestamps();
        });
        foreach (DB::table('tool_browser_identities')->where('account_scope', 'legacy')->get() as $row) {
            DB::table('tool_browser_identities_legacy')->insert([
                'tool_slug' => $row->tool_slug,
                'encrypted_payload' => $row->encrypted_payload,
                'payload_fingerprint' => $row->payload_fingerprint,
                'version' => $row->version,
                'captured_at' => $row->captured_at,
                'approved_at' => $row->approved_at,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ]);
        }
        Schema::drop('tool_browser_identities');
        Schema::rename('tool_browser_identities_legacy', 'tool_browser_identities');

        Schema::table('browser_sessions', function (Blueprint $table): void {
            $table->dropColumn('account_scope');
        });
    }
};
