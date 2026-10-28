---
name: lua-chat
description: "Send a one-shot message to the agent in sandbox or production on an isolated thread. Wraps `lua chat --ci -e <env> -m \"<text>\" -t [id]`."
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

You are `/lua-chat`. The user wants to send a message to their agent.

## Step 0 — auth preflight (auto-resolve via skill)

Run `Bash(lua models list --json --ci)` — a 1–2 s authenticated call (no project needed). Exit 0 or 10 = authenticated (10 = a typed key scoped away from the model catalog; fine). Exit 9 = not authenticated: follow the `lua-auth` skill, then re-probe; if still 9, abort with the CLI error verbatim. Exit 11 = the Lua API is unreachable: abort with that line (do not start a login). Do not use `lua agents` as the probe — it walks every organisation and can take 20 s or more on large accounts.

## Step 1 — collect inputs (single permission per §3.7)

If `$ARGUMENTS` carries the message, use it (default env sandbox, new thread). Otherwise ask the user **once**:

- "Environment?" (options: `sandbox` (default — compiles locally and pushes your skills/processors to the sandbox first, so it tests current source. ⚠ Each push uploads the **entire environment of the shell your coding agent runs in**, merged with `.env`, as the versions' `env` — and the runtime never reads it (a sandbox turn's `env()` is the agent's server-side env). If that shell holds cloud keys or tokens you would not hand to the platform, start your coding agent from a clean shell first — e.g. `env -i HOME="$HOME" PATH="$PATH" TERM="$TERM" zsh -f` — or use `production` / `/lua-test`, which upload nothing; a platform fix is tracked), `production` (the live agent))
- "Message?" (free-text, required)
- "New thread or continue existing?" (options: `New thread`, `Continue thread <id>` if a recent thread id is in context)

## Step 2 — run

- New thread → `Bash(lua chat --ci -e <env> -m '<message>' -t)` — bare `-t` makes lua-cli generate a fresh thread id and print it (`ℹ️ Thread: …`). **Never omit `-t`**: without it the message lands in the agent's *default* thread for your user.
- Continue → `Bash(lua chat --ci -e <env> -m '<message>' -t <id>)`.

Before the first sandbox run in a session say once, in one line, that sandbox chat uploads the shell's environment variables to the platform (lua-cli 3.33.0; see SECURITY.md) — then run the plain command; never wrap it in `env -i` yourself (the permission rule and the `-t` lint expect the plain form). `lua chat` has **no `--json`**; the reply is streamed text after a `🌙 Response:` line. `-e production` talks to the live agent and counts as a real conversation. `--agent-version <n>` previews an unpromoted agent version in an isolated thread (production only).

## Step 3 — present

Show the agent's reply and the thread id (so the user can continue it). Surface a non-zero exit with its one-line error: `9` not authenticated, `10` the credential's scope excludes this agent, `12` the model provider refused the request (key/model/quota). Do not retry.
