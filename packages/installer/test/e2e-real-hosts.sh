#!/usr/bin/env bash
set -uo pipefail

tarball="${1:?usage: e2e-real-hosts.sh <agent-kit tarball>}"
work="$(mktemp -d)"
export HOME="$work/home" DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npm_config_update_notifier=false
mkdir -p "$HOME/.codex" "$work/project"
git -C "$work/project" init -q
cd "$work/project" || exit 1
kit="$HOME/.lua/agent-kit"
fails=0

check() {
  if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fails=$((fails + 1)); fi
}

agentkit() {
  npx --yes --package "$tarball" agent-kit "$@"
}

echo "fake HOME: $HOME"
agentkit install --agent claude-code,codex --dry-run >"$work/dry.log" 2>&1
check "dry run exits 0 and writes no hub" '[ ! -e "$kit" ] && grep -q "Dry run: nothing was written" "$work/dry.log"'

agentkit install --agent claude-code,codex --yes >"$work/install.log" 2>&1
check "install exits 0" 'grep -q "^Done:" "$work/install.log" && ! grep -q "failed" "$work/install.log"'
check "claude lists the plugin from the hub" 'claude plugin list --json | grep -q "\"lua-agent-builder@claude-code-lua-plugin\""'
check "codex lists the plugin installed" 'codex plugin list --json | grep -q "\"installed\": true"'
check "universal skills are links into the hub" '[ -L "$HOME/.agents/skills/lua-deploy" ]'

agentkit install --agent claude-code,codex --yes >"$work/again.log" 2>&1
check "re-running install is a no-op" '! grep -Eq "^  (add|re-point|rewrite) " "$work/again.log" && grep -q "plugin already installed" "$work/again.log"'

agentkit doctor >"$work/doctor.log" 2>&1
check "doctor: Claude Code Tier A" 'grep -q "Claude Code: detected .*installed, Tier A" "$work/doctor.log"'
check "doctor: Codex Tier B" 'grep -q "Codex: detected .*installed, Tier B" "$work/doctor.log"'
check "doctor: both gate self-tests pass" '[ "$(grep -c "gate self-test on .*: ok" "$work/doctor.log")" = 2 ]'

next="$work/payload-next"
cp -R "$kit/$(readlink "$kit/current")" "$next"
rm -f "$next/.digest"
node -e 'const f=process.argv[1];const m=JSON.parse(require("fs").readFileSync(f));m.version="99.0.0";require("fs").writeFileSync(f,JSON.stringify(m))' "$next/manifest.json"
echo next > "$next/skills/lua-deploy/NEXT.md"
before="$(readlink "$kit/current")"
LUA_AGENT_KIT_PAYLOAD="$next" agentkit update >"$work/update.log" 2>&1
check "update re-points current to 99.0.0" '[ "$(readlink "$kit/current")" = 99.0.0 ] && [ -f "$HOME/.agents/skills/lua-deploy/NEXT.md" ]'
check "update re-registers the Claude marketplace at 99.0.0" 'claude plugin marketplace list --json | grep -q "agent-kit/99.0.0/claude-code"'
LUA_AGENT_KIT_PAYLOAD="$next" agentkit update --to "$before" >"$work/rollback.log" 2>&1
check "rollback re-points current to $before" '[ "$(readlink "$kit/current")" = "$before" ] && [ ! -f "$HOME/.agents/skills/lua-deploy/NEXT.md" ]'
check "rollback re-registers the Claude marketplace at $before" 'claude plugin marketplace list --json | grep -q "agent-kit/$before/claude-code"'

mkdir -p "$HOME/.claude/skills/lua-deploy"
echo mine > "$HOME/.claude/skills/lua-deploy/SKILL.md"
agentkit install --agent claude-code --skills-only --yes >"$work/collide.log" 2>&1
check "user-authored ~/.claude/skills/lua-deploy is reported" 'grep -q "SKIP.*\.claude/skills/lua-deploy" "$work/collide.log"'
check "user-authored ~/.claude/skills/lua-deploy is untouched" '[ "$(cat "$HOME/.claude/skills/lua-deploy/SKILL.md")" = mine ] && [ ! -L "$HOME/.claude/skills/lua-deploy" ]'

agentkit install --project --agent claude-code --skills-only --yes >"$work/project.log" 2>&1
check "project scope writes copies" '[ -d .claude/skills/lua-auth ] && [ ! -L .claude/skills/lua-auth ]'

agentkit install --agent cursor --yes >"$work/cursor.log" 2>&1
agentkit doctor >"$work/doctor-cursor.log" 2>&1
check "cursor: hooks.json written with failClosed on the gate" 'grep -q "confirm-deploy.mjs.*failClosed\": true" "$HOME/.cursor/hooks.json"'
check "doctor: Cursor Tier B with a passing gate self-test" 'grep -q "Cursor: .*installed, Tier B" "$work/doctor-cursor.log" && grep -A3 "^Cursor:" "$work/doctor-cursor.log" | grep -q "gate self-test on .*: ok"'

mkdir -p "$kit/data" && echo keep > "$kit/data/keep.txt"
agentkit uninstall >"$work/uninstall.log" 2>&1
check "uninstall: scratch project git status clean" '[ -z "$(git status --porcelain)" ]'
check "uninstall: only data/ left in the hub" '[ "$(cd "$kit" && find . -mindepth 1 | sort | tr "\n" " ")" = "./data ./data/keep.txt " ]'
check "uninstall: no universal links left" '[ ! -e "$HOME/.agents" ]'
check "uninstall: claude plugin and marketplace gone" '! claude plugin list --json | grep -q lua-agent-builder && ! claude plugin marketplace list --json | grep -q claude-code-lua-plugin'
check "uninstall: codex plugin and marketplace gone" '! codex plugin marketplace list --json | grep -q lua-ai-marketplace'
check "uninstall: cursor hooks.json and mcp.json removed" '[ ! -e "$HOME/.cursor/hooks.json" ] && [ ! -e "$HOME/.cursor/mcp.json" ]'
check "uninstall: user-authored skill still there" '[ "$(cat "$HOME/.claude/skills/lua-deploy/SKILL.md")" = mine ]'

LUA_AGENT_KIT_NO_SYMLINKS=1 agentkit install --agent gemini --yes >"$work/copy.log" 2>&1
check "symlink refusal falls back to copy, recorded as kind copy" '[ -d "$HOME/.gemini/skills/lua-deploy" ] && [ ! -L "$HOME/.gemini/skills/lua-deploy" ] && ! grep -q "\"kind\": \"link\"" "$kit/installed.json" && grep -q "\"kind\": \"copy\"" "$kit/installed.json"'
agentkit uninstall --purge-data >/dev/null 2>&1
check "uninstall --purge-data removes the hub" '[ ! -e "$kit" ]'

echo "logs: $work"
echo "failures: $fails"
exit "$fails"
