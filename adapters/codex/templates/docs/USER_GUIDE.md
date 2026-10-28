# Lua Agent Builder for Codex CLI — User Guide

Complete walkthrough: install → authenticate → ship a Lua agent end-to-end. Assumes Codex CLI is installed (`npm install -g @openai/codex`). If you're a tester rather than a regular user, read [TESTERS.md](./TESTERS.md) first for the 5-minute setup + how to report bugs.

---

## 1. Install

```bash
# Clone (path is your dev location; install command tells Codex about it)
git clone https://github.com/lua-ai-global/codex-lua-plugin ~/codex-lua-plugin
cd ~/codex-lua-plugin

# Build the bundled MCP server (gitignored — must exist before install)
cd mcp/lua-platform && npm ci && npm run build && cd ../..

# Install via Codex's first-class plugin system
node scripts/install.mjs
```

What `install.mjs` does:

- Pre-flights that `codex` CLI is on your PATH (install with `npm install -g @openai/codex` if not)
- Pre-flights that the MCP server bundle was built (`mcp/lua-platform/dist/server.js`)
- Runs `codex plugin marketplace add ./` to register this repo as a Codex marketplace
- Runs `codex plugin install lua-agent-builder` to install the plugin
- Codex caches the plugin at `~/.codex/plugins/cache/lua-ai-marketplace/lua-agent-builder/<version>/` and reads skills, hooks, and MCP from the bundled manifest

To uninstall: `node scripts/install.mjs --uninstall` — removes both the plugin AND the marketplace registration.

To update: `cd ~/codex-lua-plugin && git pull && node scripts/install.mjs` — idempotent; Codex re-reads the manifest and updates components in-place.

---

## 2. Verify install

In Codex, type `/` — autocomplete should list 14 skills:

> `/lua-architect`, `/lua-auth`, `/lua-chat`, `/lua-deploy`, `/lua-docs`, `/lua-doctor`, `/lua-init`, `/lua-logs`, `/lua-new`, `/lua-push`, `/lua-qa`, `/lua-sync`, `/lua-test`, `/lua-update`

Then ask the agent: *"What MCP tools do you have available?"* — you should see the `lua-platform` server's 5 tools (`list_agents`, `get_agent`, `list_primitive_versions`, `get_deployment_status`, `tail_logs`).

If any of this fails, see the [Troubleshooting](#7-troubleshooting) section below.

---

## 3. Authenticate

```
/lua-auth
```

The skill first runs `lua agents --json --ci`. If a credential from `LUA_API_KEY`, `~/.lua-cli/credentials`, or the project's `.env` file works, the plugin leaves it unchanged. Existing non-dotted legacy keys remain supported.

For a new login, install lua-cli 3.28.0 or newer. Open a terminal outside Codex and run `lua auth configure`, then choose the email option. The CLI handles your email and OTP, then requires an organization, one or more exact agents, and an assignable role. Builder is the default role. The CLI writes the typed personal credential to `~/.lua-cli/credentials` with mode `0600`.

If you already have a credential that is not configured, choose the existing-key option in the private terminal. Existing automation can keep using `LUA_API_KEY` or `.env`.

Never paste an email, an OTP, or a credential into the Codex conversation. The safety hook denies model-run `lua auth configure` and `lua auth key*` commands.

Verify with:

```
/lua-doctor
```

`/lua-doctor` runs a 5-step environment diagnostic: Node version, lua-cli version, MCP wiring, auth state, and rule attachment. If anything is off, it walks you through the fix.

---

## 4. Build your first agent

The recommended flow is **architect → init → primitives → test → deploy**. Each step is a separate skill so the §3.7 single-permission contract holds (one prompt per skill).

### 4.1 Architect

```
/lua-architect I want to build a refund-handling agent
```

The architect attaches the `@primitives`, `@integrations`, `@decision-trees` rules and produces a structured plan:

- **Persona & model** — voice, scope, refusal behaviour, model recommendation.
- **Primitives** — tools (skills), webhooks, jobs, processors, data model.
- **Integrations** — which Unified.to connectors to use, what the MCP exposes (verified, not assumed), what triggers to subscribe to with proposed handler responsibilities.
- **Build order** — sequenced steps you can hand off to the next skills.

The architect deliberately uses the **MCP-first pattern**: it never proposes a custom tool that duplicates an integration's MCP capability. Before listing custom tools it instructs you to verify the MCP's actual surface (since coverage varies per Unified.to integration).

### 4.2 Initialise

```
/lua-init
```

The skill collects: agent name, organisation (existing or new), model, whether to include example skills, and an optional **promo code** (Lua periodically issues codes that grant bonus credits at agent-creation time; see [admin.heylua.ai](https://admin.heylua.ai) for active codes).

It runs `lua init --ci ...` with the gathered inputs. Auth and lua-cli version are auto-resolved if missing — no need to run `/lua-auth` first.

### 4.3 Scaffold primitives

```
/lua-new tool refund_lookup
/lua-new webhook stripe_refunds
/lua-new job daily_report
```

Each invocation dispatches the `lua-skill-builder` agent which scaffolds the file (using class-based pattern + Zod schema), wires it into `lua.skill.yaml`, runs `lua compile`, and runs `lua test` for the primitive.

### 4.4 Connect integrations

The architect tells you which integrations to connect. For each:

```bash
# Tier C — interactive. Run in a terminal pane.
lua integrations connect --integration stripe --auth-method oauth --scopes all \
  --triggers payment_intent.succeeded,payment_intent.payment_failed,charge.refunded
```

The CLI opens a browser for OAuth, creates the connection, **auto-provisions an MCP server**, and (if `--triggers` was passed) creates the webhook subscriptions. Verify the MCP is active:

```bash
lua integrations mcp list                    # confirm Active
lua integrations webhooks events --integration stripe --json   # discover all available events
lua integrations webhooks list --json        # see what's already subscribed
```

After activating, restart Codex so the new MCP server loads. The integration's tools appear under the `mcp__stripe__*` prefix — the agent can call them directly without you writing tool code.

### 4.5 Test

```
/lua-test
```

Picks the right `lua test` form for each primitive type (skill / webhook / job) and exercises it in sandbox. If a test fails, it auto-hands off to the `lua-debug` subagent to diagnose.

```
/lua-qa
```

Runs a conversational QA pass — exercises the persona against the primitives in either sandbox (if drift detected) or production (if clean), and writes a triage report routing findings to `lua-debug` or `lua-skill-builder`.

### 4.6 Deploy

```
/lua-deploy
```

The skill dispatches `lua-deploy-pilot` which walks the gated 5-step ship sequence: compile → sync check → push → smoke test → deploy. The §3.3 safety contract enforces explicit user confirmation before the production deploy fires; bypassing it via `--auto-deploy` or bare `lua deploy` is blocked by the `before-shell-execution.mjs` hook.

---

## 5. Day-2 operations

```
/lua-sync   → detect drift between local code and server state, pull or push
/lua-logs   → view recent agent logs (skill, webhook, job, etc.) with filtering
/lua-chat   → one-shot or threaded conversation with the agent in sandbox or production
/lua-push   → push primitives to server without deploying
/lua-update → update lua-cli to the latest version
/lua-docs   → search heylua.ai docs from inside Codex
```

---

## 6. Subagents (Codex TOML format)

The five subagents under `agents/` are dispatched automatically by the matching skills. Codex stores subagents as TOML files (`agents/<name>.toml`) with `name`, `description`, `developer_instructions`, and optional `model` / `mcp_servers` keys.

| Agent | What it does |
|---|---|
| `lua-architect` | Goal → architecture mapping (reads the 3 attached rules) |
| `lua-skill-builder` | Scaffolds primitives, runs compile loop |
| `lua-debug` | Diagnoses compile/test failures, proposes minimal fixes |
| `lua-deploy-pilot` | 5-step gated ship sequence |
| `lua-qa` | Conversational QA, triage report |

You can invoke a subagent directly from a Codex prompt: *"Have lua-architect plan a refund-handling agent."* Codex picks the matching subagent and spawns it.

---

## 7. Safety contracts (worth knowing)

The plugin enforces three gates via four `PreToolUse` hooks. Codex's hook protocol matches Claude Code's exactly (PascalCase event names, exit code 2 to block, JSON envelope `{hookSpecificOutput: {hookEventName, permissionDecision}}` for advanced decisions):

| Gate | Hook(s) that enforce it |
|---|---|
| **`lua deploy`** without `LUA_DEPLOY_CONFIRMED=1` is denied | `before-shell-execution.mjs` (umbrella) + `confirm-deploy.mjs` |
| **`--auto-deploy`** in any command is denied | `before-shell-execution.mjs` + `block-auto-deploy.mjs` |
| **`lua auth key*`** is denied (would print key to transcript) | `before-shell-execution.mjs` (umbrella) |

The umbrella hook gives the cleanest deny message; the dedicated hooks are defense-in-depth. All hooks self-filter based on the actual command — they're safe regardless of the host's matcher behaviour (see the corresponding `confirm-deploy.mjs` fix in the Cursor port for the bug-class history).

To bypass the deploy gate intentionally (e.g. for a deliberate prod ship), prefix:

```bash
LUA_DEPLOY_CONFIRMED=1 lua deploy skill --name foo --skill-version 1.0.0 --force
```

The `/lua-deploy` skill sets this env var automatically after walking you through the gated 5-step sequence.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `node scripts/install.mjs` says "Codex CLI not on PATH" | Codex CLI not installed | `npm install -g @openai/codex`, then re-run install |
| `node scripts/install.mjs` says "MCP server bundle not found" | Build step skipped | `cd mcp/lua-platform && npm ci && npm run build`, then re-run install |
| `/lua-` doesn't autocomplete in Codex | Plugin install reported success but Codex didn't reload | Restart Codex completely (close all sessions) |
| MCP tools missing from agent | No working credential | Run `/lua-auth`. Existing automation can keep using `LUA_API_KEY='<existing-credential>'`. |
| **All shell commands rejected with `DEPLOY_DENIED_BARE`** | Stale install (pre-bug-fix `confirm-deploy.mjs`) | `cd ~/codex-lua-plugin && git pull && node scripts/install.mjs` |
| Architect proposes custom tools that duplicate an integration's API | Rare, but if seen: the architect didn't run the MCP discovery step | Manually attach `@integrations`, then re-prompt with: "Verify the MCP surface for `<integration>` before listing custom tools" |
| Want to start fresh | n/a | `node scripts/install.mjs --uninstall && node scripts/install.mjs` — clean re-install |

For deeper issues, see [SECURITY.md](../SECURITY.md) for the disclosure path or open an issue at [github.com/lua-ai-global/codex-lua-plugin/issues](https://github.com/lua-ai-global/codex-lua-plugin/issues).

---

## 9. Uninstall

```bash
cd ~/codex-lua-plugin
node scripts/install.mjs --uninstall
# Optionally also remove the dev clone:
rm -rf ~/codex-lua-plugin
```

The uninstall script:
- Runs `codex plugin uninstall lua-agent-builder` (removes the cached plugin)
- Runs `codex plugin marketplace remove lua-ai-marketplace` (removes our marketplace registration)
- Your other Codex plugins, marketplaces, and config are not touched

Your local Lua CLI auth credentials at `~/.lua-cli/credentials` are NOT touched by uninstall — log out separately with `lua auth logout` if you want.
