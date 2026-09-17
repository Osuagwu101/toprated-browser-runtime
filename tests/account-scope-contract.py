#!/usr/bin/env python3
from pathlib import Path

checks = {
    "api/app/Http/Controllers/SessionController.php": [
        "account_id",
        "identities->load($toolSlug, $accountScope)",
        "requireReauthentication($toolSlug, 'BROWSER_IDENTITY_MISSING', $accountScope)",
    ],
    "api/app/Http/Controllers/ToolAuthController.php": [
        "accountScope($request)",
        "identities->save($tool, $normalizedState, null, $accountScope)",
        "markVerified($tool, $accountScope)",
    ],
    "api/app/Services/PersistentBrowserIdentity.php": [
        "where('account_scope', $accountScope)",
        "['tool_slug' => $toolSlug, 'account_scope' => $accountScope]",
    ],
    "api/app/Services/SessionManager.php": [
        "'account_scope' => $accountScope",
        "account_scope_changed",
        "operatorWriterId($toolSlug, $accountScope)",
        "ACCOUNT_SESSION_ACTIVE",
        "->where('account_scope', $accountScope)",
    ],
    "api/database/migrations/2026_09_15_000006_scope_identity_by_account.php": [
        "$table->primary(['tool_slug', 'account_scope'])",
        "$table->string('account_scope', 191)->default('legacy')->index()",
    ],
}

for filename, needles in checks.items():
    content = Path(filename).read_text()
    for needle in needles:
        if needle not in content:
            raise SystemExit(f"account-scope contract missing {needle!r} in {filename}")

print("account_scope_contract=pass")
