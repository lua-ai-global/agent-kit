# Security Policy

## Reporting a vulnerability

Email **security@heylua.ai** with the details. Please do NOT open a public GitHub issue for security reports.

We aim to acknowledge within 2 business days and ship a fix within 30 days for high-severity issues.

## Scope

This plugin's surface includes:

- **Skills** (`skills/<name>/SKILL.md`) — Markdown prompts that Codex loads as `/lua-*` slash commands. Bundled via the plugin manifest at `.codex-plugin/plugin.json`.
- **Subagents** (`agents/*.toml`) — Codex TOML-format subagent definitions with `name`, `description`, `developer_instructions`. Bundled with the plugin.
- **Hooks** (`hooks/*.mjs`) — run as Node subprocesses on `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` events. Registered in `hooks/hooks.json` (Claude-Code-shaped schema; Codex consumes it natively).
- **MCP server** (`mcp/lua-platform/dist/server.js`) — a stdio MCP server exposing 5 read-only tools. Talks to `https://api.heylua.ai` over HTTPS using the user's API key. Registered in `.mcp.json`.
- **Rules** (`rules/*.mdc`) — knowledge files attached to the architect agent's context via `@-mention`.
- **Install script** (`scripts/install.mjs`) — runs `codex plugin marketplace add` + `codex plugin install`. Does not modify any user files outside Codex's plugin cache (`~/.codex/plugins/cache/`).

In scope for security reports:

- Credential exposure (API keys leaking into transcripts, logs, environment, or external systems)
- Safety-gate bypasses (deploys or destructive operations succeeding without the documented confirmation)
- Hook payload injection (a maliciously-shaped command triggering unintended hook behavior)
- MCP server auth bypass
- Symlink-target manipulation (a bundled component resolving to a path outside the cloned plugin)

Out of scope:

- Bugs in `lua-cli` itself (report to security@heylua.ai with `[lua-cli]` in the subject)
- Bugs in `lua-api` (report to security@heylua.ai with `[lua-api]` in the subject)
- Bugs in Codex CLI itself (report to OpenAI)
- Issues in user-installed third-party MCP servers
- Social-engineering / phishing of a Lua API key from a user

## Safety-critical contracts

The plugin enforces several safety contracts. Bypasses count as security issues.

| Contract | Where enforced |
|---|---|
| **§3.3 deploy gate**: bare `lua deploy` is denied | `hooks/before-shell-execution.mjs` (umbrella) + `hooks/confirm-deploy.mjs` (dedicated) |
| **§3.3 auto-deploy block**: `--auto-deploy` is denied | `hooks/before-shell-execution.mjs` + `hooks/block-auto-deploy.mjs` |
| **Credential isolation**: account details, OTPs, and credentials never enter the Codex conversation | `skills/lua-auth/SKILL.md` sends new login to a private terminal; `hooks/before-shell-execution.mjs` denies model-run `lua auth configure` and `lua auth key*` commands |
| **§3.7 single-permission contract**: each skill asks at most one prompt per invocation | Convention enforced in skill bodies |

If you find a way to bypass any of these without an explicit user prompt, please report.

### Hook safety model under Codex

Codex sends `PreToolUse` hooks structured stdin JSON `{tool_input: {command, ...}, tool_name, hook_event_name, ...}` (the same shape as Claude Code) and accepts either an exit code (2 = block) or a JSON envelope `{hookSpecificOutput: {hookEventName, permissionDecision}}`. The plugin's hooks self-filter on `command` content rather than relying on Codex's `matcher` field — defense-in-depth in case Codex's matcher behaviour ever drifts (a bug-class we hit on the Cursor port; same mitigation applied here proactively).

The runtime adapter (`lib/hook-runtime.mjs`) detects whether it's running under Claude Code, Cursor, or Codex (via env vars or input shape) and emits the host-appropriate output protocol. The same hook scripts run unchanged on all three hosts.

## Audit history

This plugin is the third in a family ported from [`claude-code-lua-plugin`](https://github.com/lua-ai-global/claude-code-lua-plugin), which underwent 13 iterations of structured audit (commits prefixed with `iteration-`) before public release, fixing 78 documented bugs across the plugin / hook / MCP / knowledge-file surfaces. See the iteration-history comments in each lint script (`scripts/lint-*.mjs`) for the rationale behind each structural guard.

The Codex port adds:

- A new `before-shell-execution.mjs` umbrella hook covering all three §3.3 deny patterns
- Codex-runtime detection in `lib/hook-runtime.mjs` (falls through to Claude Code's protocol since Codex's hook input/output match)
- Codex-specific lints: `lint-codex-manifest`, `lint-codex-mcp-config`, `lint-codex-no-claude-root`
- Marketplace-based install via `codex plugin marketplace add` + `codex plugin install` (no symlink dance like Cursor needed)
- Conversion of subagent files from Markdown frontmatter to Codex's TOML schema
- 248/248 tests passing as of v1.0.0
