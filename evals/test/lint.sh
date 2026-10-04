#!/usr/bin/env bash
# lint.sh - static checks for the eval scripts (no model, no network, ~30 s). bash evals/test/lint.sh
#   - bash -n on every tracked .sh; each .sh is LF in the working tree (CRLF breaks bash)
#   - node --check on every tracked evals .mjs
#   - PowerShell AST parse of every tracked .ps1 (no execution)
#   - Windows portability: native curl must not be given /dev/null or /tmp paths ("-o /dev/null" fails with
#     curl exit 23 under git-bash because MSYS path conversion is off); no bare /tmp paths for native tools
# Exit 0 only if every check passes.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
source evals/bench/node.sh >/dev/null || exit 3
F=0; bad() { echo "FAIL $*"; F=$((F + 1)); }
n=0; while IFS= read -r f; do n=$((n + 1))
  bash -n "$f" 2>/dev/null || bad "bash -n $f"
  grep -q $'\r' "$f" && bad "CRLF in $f"
done < <(git ls-files '*.sh'); echo "sh: $n files"
n=0; while IFS= read -r f; do n=$((n + 1)); "$NODE_BIN" --check "$f" 2>/dev/null || bad "node --check $f"; done < <(git ls-files 'evals/*.mjs'); echo "mjs: $n files"
PS=$(git ls-files '*.ps1' | tr '\n' '|')
powershell.exe -NoProfile -Command "\$bad=0; foreach (\$f in '$PS'.Split('|')) { if (-not \$f) { continue }; \$e=\$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path \$f).Path, [ref]\$null, [ref]\$e); if (\$e.Count) { Write-Output \"FAIL ps1-parse \${f}: \$(\$e[0].Message)\"; \$bad++ } }; Write-Output \"ps1: \$('$PS'.Split('|').Where({\$_}).Count) files\"; exit \$bad" | tr -d '\r' | tee "${TMPDIR:-.}/lint-ps1.txt"
[ "${PIPESTATUS[0]}" = 0 ] || F=$((F + 1))
# curl -o /dev/null | -o /tmp/... | --output /dev/null in scripts (comments excluded)
hits=$(git grep -n -E 'curl[^#]*(-o|--output)[ =]+/(dev/null|tmp)' -- '*.sh' '*.ps1' '*.mjs' | grep -v '^[^:]*:[0-9]*:[[:space:]]*#' || true)
[ -n "$hits" ] && bad "native curl given an MSYS path: $hits"
hits=$(git grep -n -E '(^|[ "=])/tmp/' -- 'evals/*.sh' 'evals/*.ps1' 'evals/*.mjs' 'evals/*.ts' | grep -vE '^[^:]*:[0-9]*:[[:space:]]*(#|//)' || true)
[ -n "$hits" ] && bad "bare /tmp path: $hits"
[ $F = 0 ] && { echo "LINT PASS"; exit 0; } || { echo "LINT FAIL ($F)"; exit 1; }
