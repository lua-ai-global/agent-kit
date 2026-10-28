---
name: lua-env
description: "Manage agent environment variables — list, set or delete a key in sandbox (the project's .env) or production. Wraps `lua env <sandbox|staging|production> --list | -k KEY -v VALUE | -k KEY --delete`; the value never appears in the conversation."
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

You are `/lua-env`. The user typed `/lua-env $ARGUMENTS` (`[sandbox|staging|production] [list | set <KEY> | delete <KEY>]`). Facts: `../lua-agent-builder/references/cli-reference.md` §4 (the `lua env` row) and `../lua-agent-builder/references/primitives.md` §12 `env(key)` (how a value is read locally vs deployed).

## Step 0 — auth preflight (auto-resolve via skill)

Run `Bash(lua models list --json --ci)` — a 1–2 s authenticated call (no project needed). Exit 0 or 10 = authenticated (10 = a typed key scoped away from the model catalog; fine). Exit 9 = not authenticated: follow the `lua-auth` skill, then re-probe; if still 9, abort with the CLI error verbatim. Exit 11 = the Lua API is unreachable: abort with that line (do not start a login). Do not use `lua agents` as the probe — it walks every organisation and can take 20 s or more on large accounts.

## Step 1 — collect what is missing (single permission per §3.7)

Parse `$ARGUMENTS`. Whatever is still missing, ask the user **once**, with every question in the same call:

- "Environment?" (options: `sandbox` — writes the project's local `.env` only (no API call); that file is what `lua test` reads; `lua chat -e sandbox` also uploads it — merged over the whole shell environment — with each sandbox skill version, but the runtime never reads that upload (a sandbox turn's `env()` is the agent's server-side env); `production` — the live agent's variables, via the server API. `staging` is the CLI's alias for `sandbox`)
- "Action?" (options: `list`, `set`, `delete`)
- "Key?" (free-text; letters, digits and underscores, not starting with a digit — the CLI validates `/^[A-Z_][A-Z0-9_]*$/i`)
- "Value?" (free-text; `set` only. It goes straight into the command and is never repeated back)

Never ask a second time, and never ask for a value when the action is `list` or `delete`.

## Step 2 — run (the Bash permission prompt IS the confirmation)

`lua env *` sits in the `ask` tier of the plugin's permission template (installed by `/lua-doctor`), so your coding agent shows the user the exact command and waits for approval. Do **not** add an ask the user on top — that would prompt twice. (If the project has no `.claude/settings.json` rules yet, say so and point at `/lua-doctor` rather than running unprompted.) Build the exact command and run it:

- list → `Bash(lua env <env> --ci --list)`
- set → `Bash(lua env <env> --ci -k <KEY> -v '<value>')` — single-quote the value; a literal `'` inside it becomes `'\''`
- delete → `Bash(lua env <env> --ci -k <KEY> --delete)`

Always pass the environment positionally: flags without it exit 2 (`Environment must be specified when using non-interactive options`), and a bare `lua env` opens a raw menu that ignores `--ci`. Verified against lua-cli 3.33.0 `src/cli/command-definitions.ts` (~580) and `src/commands/env.ts`: the flags are `-k, --key`, `-v, --value`, `-d, --delete`, `--list`; there is no `--json`. What each does (env.ts): **sandbox** parses `./.env` (`KEY=value` lines, `#` lines skipped, surrounding quotes stripped) and writes the whole file back — comments and blank lines are dropped; **production** GETs the agent's env map, merges the change and PUTs it back (or DELETEs the one key). `set` prints `Created|Updated <KEY>` and `✅ Successfully set <KEY>` — the CLI never echoes the value; `delete` of an unknown key is `Variable "<KEY>" not found` (exit 1).

## Step 3 — present (no value ever reaches the transcript)

- In your summary write the command as `lua env <env> -k <KEY> -v '<redacted>'` — never the value, even though the user pasted it a moment ago.
- `--list` prints `KEY = abcd****` (the CLI masks everything after the first 4 characters — `maskValue` in env.ts). Report the **key names** and the count only; do not copy the masked fragments.
- After a `sandbox` set, `lua test` / `lua test workflow` pick the new value up on their next run (they merge `.env` over `process.env`), the next `lua chat -e sandbox` uploads the merged map too, but a sandbox turn's `env()` does **not** read it — it reads the agent's server-side env (`subAgent.env`, lua-core `skill-eligibility.resolver.ts`), so a key that a sandbox *chat* must see is set with `production` (primitives.md §12 `env(key)`). After a `production` set, new invocations see it at once; the CLI hints a production chat to verify — offer `/lua-chat` (production) instead of running it here.
- A key that a workflow references with `env.template()` must not end in `SECRET|TOKEN|KEY|PASSWORD` (`env-template-secret-key` at compile) — those are read with `env('KEY')` inside `execute`; `lua workflows env-overlay <name> -v latest` shows which template keys resolve after the set.
- Exit codes: `2` usage (missing environment, `-k` without `-v`/`--delete`, bad key format), `9` auth (→ `/lua-auth`), `11` API unreachable.
