#!/usr/bin/env bash
set -euo pipefail

adapter="${1:?usage: build/test-dist.sh <adapter> [plugin-subdir]}"
subdir="${2:-}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/lua-kit-test-${adapter}-XXXXXX")"
trap 'rm -rf "$work"' EXIT

cp -R "$root/dist/$adapter" "$work/repo"
plugin="$work/repo/$subdir"

cd "$plugin"
npm ci --no-audit --no-fund >/dev/null
echo "== $adapter: lint"
LINT_OFFLINE=1 npm run --silent lint
echo "== $adapter: test:coverage"
status=0
npm run --silent test:coverage -- --maxWorkers=2 >"$work/test.log" 2>&1 || status=$?
grep -E '^(Test Suites|Tests|Snapshots):|✓|✗|FAIL' "$work/test.log" || true
if [ -f mcp/lua-platform/package.json ] && [ -d mcp/lua-platform/tests ]; then
  echo "== $adapter: mcp/lua-platform test"
  (cd mcp/lua-platform && npm ci --no-audit --no-fund >/dev/null && npm test --silent -- --maxWorkers=2 2>&1 | grep -E '^(Test Suites|Tests):|FAIL')
fi
exit "$status"
