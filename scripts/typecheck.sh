#!/usr/bin/env bash
set -euo pipefail

printf 'node_syntax_check=begin\n'
while IFS= read -r -d '' file; do
  node --check "$file" >/dev/null
  printf 'node_ok=%s\n' "$file"
done < <(find browser-worker -type f -name '*.mjs' -print0 | sort -z)

printf 'php_syntax_check=begin\n'
while IFS= read -r -d '' file; do
  php -l "$file" >/dev/null
  printf 'php_ok=%s\n' "$file"
done < <(find api -type f -name '*.php' -not -path '*/vendor/*' -print0 | sort -z)

printf 'python_compile_check=begin\n'
python3 -m py_compile tests/*.py scripts/*.py

printf 'powershell_syntax_check=begin\n'
if command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -NonInteractive -Command '$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile("scripts/phase10-desktop-live-account-validation.ps1", [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }'
  printf 'powershell_ok=%s\n' 'scripts/phase10-desktop-live-account-validation.ps1'
else
  printf 'powershell_check=skipped-pwsh-unavailable\n'
fi

printf 'json_validation=begin\n'python3 -m json.tool api/composer.json >/dev/null
python3 -m json.tool api/config/tool-profiles.json >/dev/null
python3 -m json.tool browser-worker/package.json >/dev/null

printf 'compose_validation=begin\n'
docker compose config --quiet

printf 'repository_typecheck=pass\n'
