# Testing the Lua Agent Builder for Codex CLI

Thanks for helping shake this out before public release. This page is the 5-minute setup + what to look at + how to report bugs.

---

## 1. Setup (5 minutes)

```bash
# Prereq: Codex CLI must be installed
npm install -g @openai/codex

# Clone
git clone https://github.com/lua-ai-global/codex-lua-plugin ~/codex-lua-plugin
cd ~/codex-lua-plugin

# Build the bundled MCP server (gitignored)
cd mcp/lua-platform && npm ci && npm run build && cd ../..

# Wire skills + MCP + hooks into Codex via its plugin system
node scripts/install.mjs
```

The install script tells you exactly what it did (registered marketplace, installed plugin) and any pre-flight failures (missing Codex CLI or unbuilt MCP server) come with explicit fix commands.

To clean up afterwards: `node scripts/install.mjs --uninstall` — removes both the plugin and the marketplace registration.

---

## 2. Sanity check (30 seconds)

In Codex:

1. **Skills loaded** — type `/` and confirm autocomplete shows 14 entries (`lua-architect`, `lua-init`, `lua-doctor`, `lua-deploy`, etc.).
2. **MCP loaded** — ask: *"What MCP tools do you have?"* — confirm 5 entries with names like `list_agents`, `get_agent`, `list_primitive_versions`, `get_deployment_status`, `tail_logs`.
3. **Safety hook fires** — ask the agent to run `lua deploy skill --name foo --skill-version 1.0.0 --force`. Codex should reject it with a `DEPLOY_DENIED_BARE` message pointing you at `/lua-deploy` instead.
4. **Plain commands pass** — ask the agent to run `node --version`. It should run normally, no rejection.

If any of those four checks fails, see [Common gotchas](#5-common-gotchas) below or jump straight to [How to report a bug](#7-how-to-report-a-bug).

---

## 3. End-to-end smoke test (10 minutes)

Once the sanity check passes, walk a full agent build to verify the integration works in your own environment:

```
/lua-auth                                       # private typed login through lua-cli 3.28.0+
/lua-doctor                                     # 5-step env diagnostic
/lua-architect Build me an agent that summarises my Stripe refund history
                                                # produces a structured plan
/lua-init                                       # scaffolds the project (asks for name + org + model)
/lua-test                                       # exercises the starter primitives in sandbox
```

You don't need to run `/lua-deploy` for the smoke test (that ships to production). Stopping after `/lua-test` is enough to validate the full toolchain works.

---

## 4. What we're specifically watching for

This is a fresh port from the Cursor and Claude Code plugins, so the things most likely to break are at the Codex-specific seams:

| Area | What we want to know |
|---|---|
| **Plugin install** | Does `codex plugin marketplace add` + `codex plugin install` succeed cleanly? Any cache/permission errors? |
| **Skill autocomplete** | Do all 14 `/lua-*` skills appear after install? Any conflict with Codex built-in skills? |
| **MCP tool surface** | Are the 5 `mcp__lua-platform__*` tools (or however Codex exposes them) callable? Any auth errors when they hit api.heylua.ai? |
| **Hook firing** | Does `/lua-doctor` complete all 5 steps? Any commands silently blocked? |
| **Subagent dispatch (TOML format)** | When `/lua-architect` runs, does Codex actually invoke the `lua-architect.toml` subagent? Does the rules attachment work? |
| **TOML agent format** | We converted the agents from Markdown frontmatter to Codex TOML — confirm Codex parses them correctly and the prompt body comes through |
| **Multi-step skills** | Skills like `/lua-init`, `/lua-doctor`, `/lua-deploy` ask multi-question prompts. How does Codex render these? |
| **Cross-platform** | If you're on Windows or Linux, does install + invoke work end-to-end? |

---

## 5. Common gotchas

| You see | Probably | Fix |
|---|---|---|
| `node scripts/install.mjs` says "Codex CLI not on PATH" | Codex isn't installed | `npm install -g @openai/codex` |
| `node scripts/install.mjs` says "MCP server bundle not found" | Build step skipped | `cd mcp/lua-platform && npm ci && npm run build` then re-run install |
| `/lua-` doesn't autocomplete | Plugin installed but Codex needs reload | Fully exit and reopen Codex |
| MCP tools missing | No working credential | Run `/lua-auth`. Existing automation can keep `LUA_API_KEY='<existing-credential>'`. |
| Every shell command rejected with `DEPLOY_DENIED_BARE` | Stale install (pre-fix bug from earlier ports) | `git pull && node scripts/install.mjs` |
| `lua agents --json --ci` returns nothing in `/lua-doctor` | Auth state out of sync | Re-run `/lua-auth` |

---

## 6. Things that won't work yet (known)

- **Codex marketplace listing** — we're targeting OpenAI's official marketplace AFTER tester feedback. For now only the local `install.mjs` flow works.
- **Subagent invocation patterns** — Codex docs don't fully spec how skills dispatch into TOML subagents (the docs imply natural language is the trigger). We've ported the subagent files but the actual dispatch UX needs tester verification.
- **Hook event coverage** — we've confirmed `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit` work; `Stop` and `PermissionRequest` aren't yet exercised by any of our hooks.

---

## 7. How to report a bug

For functional bugs, open an issue at [github.com/lua-ai-global/codex-lua-plugin/issues](https://github.com/lua-ai-global/codex-lua-plugin/issues) with:

- **Codex CLI version** — `codex --version`
- **Platform** — macOS / Linux / Windows + version
- **What you did** — copy the skill invocation or terminal command
- **What you expected** — one sentence
- **What happened** — paste the actual output, including any `DEPLOY_DENIED_*` text or hook stderr if visible
- **Install state** — output of these:
  ```bash
  codex plugin list                                            # should include lua-agent-builder
  codex plugin marketplace list                                # should include lua-ai-marketplace
  ls ~/.codex/plugins/cache/lua-ai-marketplace/lua-agent-builder/   # should show version dir
  ```

For **security issues** (credential leaks, gate bypasses, hook injection): email **security@heylua.ai** privately. See [SECURITY.md](../SECURITY.md) for scope.

For quick questions: ping in Slack (#codex-plugin) or DM me.

---

## 8. When you're done

If everything worked, just close the loop with a thumbs-up in the issue tracker or Slack — that lets us count green tests.

If you'd like to keep using the plugin going forward, just leave it installed; we'll push fixes as `git pull && node scripts/install.mjs`.

If you'd like to remove it cleanly:

```bash
cd ~/codex-lua-plugin && node scripts/install.mjs --uninstall
rm -rf ~/codex-lua-plugin
```

Your other Codex plugins, marketplaces, and skills are not touched.

Thanks again 🙏
