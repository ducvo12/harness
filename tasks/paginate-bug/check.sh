#!/usr/bin/env bash
# Usage: check.sh <repo-dir>. Exit 0 = pass.
set -euo pipefail
task="$(cd "$(dirname "$0")" && pwd)"
cd "$1"

# Restore the original tests, so editing them can't make the task pass.
cp "$task/repo/paginate.test.js" .
node --test >/dev/null
echo PASS
