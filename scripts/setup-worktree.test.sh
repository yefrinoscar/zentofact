#!/usr/bin/env bash
# Fixture worktrees: principal has a root node_modules but no better-auth.
# A sibling with the same lock has the workspace-nested install.
# A fresh worktree must resolve better-auth after setup-worktree.sh.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
setup_script="$script_dir/setup-worktree.sh"
fail=0

assert() {
  local msg="$1"
  shift
  if "$@"; then
    echo "PASS $msg"
  else
    echo "FAIL $msg" >&2
    fail=1
  fi
}

assert_resolves() {
  local dir="$1"
  local msg="$2"
  if (
    cd "$dir"
    node -e "require.resolve('better-auth')"
  ) >/dev/null 2>&1; then
    echo "PASS $msg"
  else
    echo "FAIL $msg" >&2
    fail=1
  fi
}

assert_not_resolves() {
  local dir="$1"
  local msg="$2"
  if (
    cd "$dir"
    node -e "require.resolve('better-auth')"
  ) >/dev/null 2>&1; then
    echo "FAIL $msg (unexpectedly resolved)" >&2
    fail=1
  else
    echo "PASS $msg"
  fi
}

write_pkg() {
  local dest="$1"
  mkdir -p "$dest"
  printf '%s\n' '{"name":"better-auth","version":"1.0.0","main":"index.js"}' >"$dest/package.json"
  printf '%s\n' 'module.exports = { ok: true };' >"$dest/index.js"
}

base="$(mktemp -d "${TMPDIR:-/tmp}/setup-worktree.XXXXXX")"
trap 'rm -rf "$base"' EXIT

principal="$base/principal"
complete="$base/complete"
fresh="$base/fresh"

mkdir -p "$principal/scripts" "$principal/packages/web" "$principal/packages/server"
cp "$setup_script" "$principal/scripts/setup-worktree.sh"
chmod +x "$principal/scripts/setup-worktree.sh"

cat >"$principal/package.json" <<'EOF'
{
  "name": "fixture",
  "private": true,
  "workspaces": ["packages/*"]
}
EOF
cat >"$principal/package-lock.json" <<'EOF'
{
  "lockfileVersion": 3,
  "packages": {
    "packages/web/node_modules/better-auth": { "version": "1.0.0" },
    "packages/server/node_modules/better-auth": { "version": "1.0.0" }
  }
}
EOF
printf '%s\n' 'SECRET=1' >"$principal/.env"
printf '%s\n' '{"name":"@z/web","dependencies":{"better-auth":"^1.0.0"}}' >"$principal/packages/web/package.json"
printf '%s\n' '{"name":"@z/server","dependencies":{"better-auth":"^1.0.0"}}' >"$principal/packages/server/package.json"
printf '%s\n' 'node_modules/' >"$principal/.gitignore"

mkdir -p "$principal/node_modules/left-pad"
printf '%s\n' '{"name":"left-pad","version":"1.0.0"}' >"$principal/node_modules/left-pad/package.json"

cd "$principal"
git init -q -b main
git config user.email "test@example.com"
git config user.name "test"
git add package.json package-lock.json .gitignore scripts packages
git add -f .env
git commit -q -m "fixture"

git worktree add -q "$complete" -b complete
git worktree add -q "$fresh" -b fresh

mkdir -p "$complete/node_modules/left-pad"
printf '%s\n' '{"name":"left-pad","version":"1.0.0"}' >"$complete/node_modules/left-pad/package.json"
write_pkg "$complete/packages/web/node_modules/better-auth"
write_pkg "$complete/packages/server/node_modules/better-auth"

assert_not_resolves "$fresh/packages/web" "fresh worktree cannot resolve better-auth before setup"
assert_resolves "$complete/packages/web" "complete sibling can resolve better-auth"

echo "---- setup on fresh worktree ----"
(
  cd "$fresh"
  bash scripts/setup-worktree.sh
)

assert_resolves "$fresh/packages/web" "fresh web resolves better-auth after setup"
assert_resolves "$fresh/packages/server" "fresh server resolves better-auth after setup"
assert "fresh root node_modules is a symlink" test -L "$fresh/node_modules"
assert "fresh web has better-auth" test -e "$fresh/packages/web/node_modules/better-auth/package.json"
assert "fresh server has better-auth" test -e "$fresh/packages/server/node_modules/better-auth/package.json"
assert "fresh .env is present" test -e "$fresh/.env"
canon() { (cd "$1" && pwd -P); }
assert "web node_modules comes from complete sibling" test "$(canon "$fresh/packages/web/node_modules")" = "$(canon "$complete/packages/web/node_modules")"
assert "server node_modules comes from complete sibling" test "$(canon "$fresh/packages/server/node_modules")" = "$(canon "$complete/packages/server/node_modules")"
assert "root node_modules does not come from incomplete principal" test "$(canon "$fresh/node_modules")" != "$(canon "$principal/node_modules")"

echo "---- rerun setup (idempotent) ----"
(
  cd "$fresh"
  bash scripts/setup-worktree.sh
)
assert_resolves "$fresh/packages/web" "fresh web still resolves better-auth after rerun"

if [ "$fail" -ne 0 ]; then
  echo "setup-worktree.test.sh failed" >&2
  exit 1
fi
echo "setup-worktree.test.sh passed"
