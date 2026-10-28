---
name: lua-update
description: "Update lua-cli to the latest published version via `npm install -g lua-cli@latest` (the CLI's own `lua update` has no flags and is interactive-free but we run npm directly so the result is visible)."
metadata:
  lua-agent-builder-tier: "C"
---

> **Tier C: the deploy gate is not enforced on this agent.** This agent runs no hook that can stop a command,
> so these skills never run a command that changes production. The production verbs are `lua deploy`, `lua skills deploy`, `lua skills production deploy`, `lua webhooks deploy`, `lua jobs deploy`, `lua preprocessors deploy`, `lua postprocessors deploy`, `lua persona production deploy`, `lua workflows deploy`, `lua workflows activate`, `lua version promote`, `lua mcp activate`, `lua marketplace template publish`, `lua marketplace template apply`, under any of the names `lua`, `heylua` and `lua-ai`.
> When a step below reaches one, print the exact command with its `LUA_DEPLOY_CONFIRMED=1` prefix for the user
> to run in their own terminal, and stop. Never pass `--auto-deploy`. Never run `lua auth key`, `lua auth configure`
> or `lua auth logout`: the first prints the API key into this conversation, the second collects an email and a
> one-time code, the third discards the credential. A command that changes organisation settings (`lua env`,
> `lua drains`, `lua devices`, `lua decisions publish|delete`, `lua browser run`, `lua integrations`, the
> `lua workflows` run controls) needs the user's explicit yes in this conversation before you run it.

You are `/lua-update`. The user wants to update their lua-cli installation.

## Step 1 — capture the current version

Run `Bash(lua --version)`; capture as `OLD_VERSION`. The plugin targets lua-cli ≥ 3.37.0 (`PINNED_MIN_LUA_CLI` in `hooks/check-lua-version.mjs`).

## Step 2 — confirm (single permission per §3.7)

ask the user **once**: "Update lua-cli? Current: `<OLD_VERSION>`. This runs `npm install -g lua-cli@latest`." (options: `Update now`, `Cancel`).

## Step 3 — run

`Bash(npm install -g lua-cli@latest --silent --no-fund --no-audit)`. If the install was made with `npm link` or Homebrew's node, npm may refuse or the binary may not change — report what npm says.

## Step 4 — verify

`Bash(lua --version)` → `NEW_VERSION`. Equal → "Already on latest." Otherwise "Updated: `<OLD>` → `<NEW>`. Changelog: https://docs.heylua.ai/changelog." If the new version raises the Node minimum, point at `/lua-doctor`.
