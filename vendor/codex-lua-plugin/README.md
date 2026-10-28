# codex-lua-plugin

A [Codex CLI](https://developers.openai.com/codex) plugin for building, testing, and deploying [Lua AI agents](https://heylua.ai) directly from inside your Codex session.

This is the Codex port of [`claude-code-lua-plugin`](https://github.com/lua-ai-global/claude-code-lua-plugin) and [`cursor-lua-agent-builder`](https://github.com/lua-ai-global/cursor-lua-agent-builder), with the same architecture, the same MCP-first integration model, the same §3.3 deploy-safety gates, and the same 14-verb workflow — adapted to Codex CLI's plugin format (`.codex-plugin/plugin.json`, marketplace-based install).

## Install

```bash
# 1. Clone (path is your dev location; install command tells Codex about it)
git clone https://github.com/lua-ai-global/codex-lua-plugin ~/codex-lua-plugin
cd ~/codex-lua-plugin

# 2. Build the bundled MCP server (gitignored — must exist before install)
cd mcp/lua-platform && npm ci && npm run build && cd ../..

# 3. Install — registers as a marketplace and triggers `codex plugin install`
node scripts/install.mjs
```

The script:
- Pre-flights that `codex` CLI is on your PATH (install with `npm install -g @openai/codex` if not)
- Pre-flights that the MCP server bundle was built
- Runs `codex plugin marketplace add ./` to register this repo as a Codex marketplace
- Runs `codex plugin install lua-agent-builder` to install the plugin from it
- Codex caches the plugin at `~/.codex/plugins/cache/lua-ai-marketplace/lua-agent-builder/<version>/`

To uninstall: `node scripts/install.mjs --uninstall` (removes the plugin AND the marketplace registration).

To update: `cd ~/codex-lua-plugin && git pull && node scripts/install.mjs` — idempotent; Codex re-reads the manifest and updates components.

In Codex, type `/` to see the `lua-*` skills in autocomplete. Run `/lua-doctor` to verify the environment, then `/lua-auth`. A new login uses `lua auth configure` in a private terminal and requires lua-cli 3.28.0 or newer.

The plugin targets lua-cli **3.38.0 or newer** (`PINNED_MIN_LUA_CLI` in `hooks/check-lua-version.mjs`): below it `lua drains` and the `lua logs` window options do not exist. An older CLI still works for the core loop — the version check warns once per session and never blocks.

`/lua-doctor` also offers to merge `lib/permissions-template.json` into the project's `.claude/settings.json`. That is what lets the safe read-only `lua` commands run without a prompt each time; without it every call asks, and in a non-interactive session an ask is a refusal.

## What's inside

| Component | Count | Role |
|---|---|---|
| Skills (`/lua-*`) | 24 | One per verb — see the table below |
| Subagents | 5 | `lua-architect`, `lua-skill-builder`, `lua-debug`, `lua-deploy-pilot`, `lua-qa` (Codex TOML format) |
| Hooks | 12 | SessionStart × 3, UserPromptSubmit × 1, PreToolUse × 6 (the deploy gate, the shell gate, the web-app approver, the device-secret and auto-deploy blocks, the version-zero warning), PostToolUse × 2 |
| Rules | 10 | Knowledge the agents attach by `@name` — see the table below |
| MCP servers | 3 | `lua-platform` (5 read-only tools: `list_agents`, `get_agent`, `list_primitive_versions`, `get_deployment_status`, `tail_logs`), plus the read-only remote `lua-docs` and `ui` catalogs |
| Lints | 17 | Catch known regression classes (the permissions contract, frontmatter, hook registration, CLI flag denylist, MCP refs, log field names, monorepo paths) |
| Tests | 937 | Jest suites against the hooks, the production-command classifier, the permissions template, the MCP tools and the runtime adapters |

### Skills

| Skill | What it does |
|---|---|
| `/lua-architect` | Plans an agent end-to-end: primitives, integrations, build order |
| `/lua-init` | Scaffolds a project with `lua init --ci` |
| `/lua-new` | Scaffolds any of the 16 primitive types and registers it |
| `/lua-test` | Runs a primitive locally with `lua test --ci`; routes a failure to `lua-debug` |
| `/lua-chat` | One-shot message to the agent on an isolated thread |
| `/lua-qa` | A conversational QA pass against sandbox or production |
| `/lua-sync` | Finds drift against the server and resolves it |
| `/lua-status` | The whole project state in one read-only call |
| `/lua-push` | Stages a version; nothing goes live |
| `/lua-version` | Agent versions: list, show, diff, create |
| `/lua-deploy` | The gated ship sequence for every kind of production change |
| `/lua-logs` | Agent logs as structured JSON, over a time window |
| `/lua-drains` | Ships the organization's logs to its own stack |
| `/lua-workflow` | Runs, inspects and steers workflows |
| `/lua-decisions` | Named decisions: run, publish, version, delete |
| `/lua-devices` | Hardware and local machines on the agent |
| `/lua-browser` | The cloud browser: read a page, drive a real site |
| `/lua-integrations` | Unified.to connectors, their MCP servers and subscriptions |
| `/lua-env` | Agent environment variables, without the value reaching the chat |
| `/lua-template` | Marketplace templates: draft, publish, apply |
| `/lua-doctor` | Diagnoses the environment and offers consented fixes |
| `/lua-auth` | Sends a login to the user's own terminal |
| `/lua-docs` | Looks something up in the Lua documentation |
| `/lua-update` | Updates lua-cli |

### Rules

`@primitives`, `@cli-reference`, `@decision-trees`, `@integrations`, `@workflows`, `@decisions`, `@devices`, `@web-apps`, `@browser`, `@log-drains`. Each is read from lua-cli source rather than the public docs, and attached on demand by `@name` so it costs no context until it is needed.

## Why a port?

Codex CLI's plugin model is genuinely close to Claude Code's:

- **Hook event names match** — `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop` (PascalCase, like Claude Code; not Cursor's camelCase). Same JSON output protocol (`{hookSpecificOutput: {hookEventName, permissionDecision}}` for blocks, exit code 2 for hard denial).
- **Skills format identical** — `skills/<name>/SKILL.md` with `name` + `description` frontmatter. Anthropic's SKILL.md standard, adopted by both.
- **MCP via `.mcp.json`** — same JSON schema as Claude Code (or `~/.codex/config.toml` `[mcp_servers]` for user-scope).
- **Plugin manifest at `.codex-plugin/plugin.json`** — same kebab-case `name`, similar field set as Cursor's `.cursor-plugin/plugin.json`.
- **Real local install** — `codex plugin marketplace add ./` is a first-class command; no symlink dance like the Cursor port needed.

The only meaningful adaptation is **subagents** — Codex uses TOML files at `agents/*.toml` with a different schema (`name`, `description`, `developer_instructions`, optional `model` / `mcp_servers`). The conversion is mechanical (frontmatter + body → TOML keys).

## Layout

```
codex-lua-plugin/
├── .codex-plugin/
│   └── plugin.json             ← Codex plugin manifest
├── marketplace.json            ← Codex marketplace pointer (this repo IS a marketplace of 1)
├── skills/                     ← 24 verbs as skills (Anthropic SKILL.md format)
│   ├── lua-architect/SKILL.md
│   └── ... (23 more)
├── agents/                     ← 5 subagents in Codex TOML format
│   ├── lua-architect.toml
│   └── ... (4 more)
├── hooks/
│   ├── hooks.json              ← Claude-Code-shaped (matcher + hooks array)
│   ├── before-shell-execution.mjs    ← §3.3 safety gate (umbrella)
│   ├── confirm-deploy.mjs / block-auto-deploy.mjs / warn-version-zero.mjs
│   ├── check-lua-version.mjs / detect-project.mjs / check-lua-auth.mjs
│   └── inject-context.mjs / post-deploy-smoke.mjs / post-compile-summary.mjs
├── rules/                      ← 10 knowledge files as MDC rules, attached by @name
├── .mcp.json                   ← MCP server registration
├── mcp/lua-platform/           ← bundled MCP server (vendored from upstream repo)
├── lib/                        ← shared utilities (hook-runtime adapter handles CC + Cursor + Codex)
├── scripts/install.mjs         ← LOCAL INSTALL via `codex plugin marketplace add`
├── test/                       ← 248 jest tests (vendored, all pass on the matrix)
└── docs/USER_GUIDE.md
```

## Safety contracts

The plugin enforces the same gates as the Claude Code and Cursor versions:

- **§3.3 deploy gate** — bare `lua deploy` is denied by `hooks/before-shell-execution.mjs` unless prefixed with `LUA_DEPLOY_CONFIRMED=1` (the `/lua-deploy` skill sets this after walking the user through the gated 5-step ship sequence).
- **`--auto-deploy` block** — denied for any command containing `--auto-deploy`.
- **Credential isolation** — model-run `lua auth configure` and `lua auth key*` commands are denied. Account details, OTPs, and credentials stay in a private terminal.
- **Single-permission contract** — preserved in the skill bodies.

See [`SECURITY.md`](./SECURITY.md) for disclosure path.

## Companion projects

- **[lua-platform-mcp](https://github.com/lua-ai-global/lua-platform-mcp)** — the standalone MCP server (also listed in the [Cline MCP Marketplace](https://cline.bot/mcp-marketplace) for direct use without an IDE plugin)
- **[claude-code-lua-plugin](https://github.com/lua-ai-global/claude-code-lua-plugin)** — Anthropic Claude Code version
- **[cursor-lua-agent-builder](https://github.com/lua-ai-global/cursor-lua-agent-builder)** — Cursor version

## License

[MIT](./LICENSE) © Lua AI
