# Changelog

All notable changes to the `lua-agent-builder` Codex plugin. Versions follow the tag `release-prod.yml` cuts from `package.json` (`v<version>`). lua-cli is a TypeScript SDK/CLI; it is unrelated to the Lua programming language.

## 1.2.0 — 2026-10-25

**Parity with the Claude Code plugin at 1.15.0.** The port had drifted a long way behind: ten of its twenty-four verbs did not exist, its knowledge base covered three subject areas out of ten, and two gates were not doing what their comments said.

### Fixed

- **The deploy gate covered only `lua deploy`.** `hooks/confirm-deploy.mjs` tested `/\blua\s+deploy\b/` and returned null for anything else, so `lua version promote` (an atomic swap of the live agent version, which asks nothing of its own), `lua skills|webhooks|jobs|preprocessors|postprocessors deploy`, `lua skills production deploy`, `lua persona production deploy`, `lua workflows deploy|activate`, `lua mcp activate` and `lua marketplace template publish|apply` all reached the server unchallenged, and the permissions template denied none of them. The regex was also anchored at the start of the string, so `cd x && lua deploy all`, `npx lua deploy all`, `/usr/local/bin/lua deploy all` and `bash -c "lua deploy all"` never reached it. `lib/tokenizer.mjs` is now the shell-aware classifier that is the single source of truth for what changes production: it lexes a command the way a POSIX shell would, recognises the CLI by basename under all three installed names, resolves the CLI's own action aliases, and fails closed on input it cannot parse.
- **`Bash(lua deploy*)` in the permissions template's deny tier made every deploy impossible.** A deny or ask rule is evaluated past a leading env assignment, so that rule also matched the confirmed `LUA_DEPLOY_CONFIRMED=1 lua deploy …` form the deploy flow emits. Once a user accepted the template into their settings, nothing could ship. The bare verbs now sit in neither restrictive tier; the hook is the gate, and `scripts/lint-permissions.mjs` plus `test/lib/permissions-mirror.test.mjs` keep it that way.
- **Credentials could pass through the shell gate under another name.** lua-cli installs the same program as `lua`, `heylua` and `lua-ai`, and the gate's rules were anchored on `\blua\s+`, which matches neither alternative: `heylua auth key` printed the raw API key into the conversation. Every rule now matches all three, with an optional path prefix so `./node_modules/.bin/lua auth key` still blocks; the alternative binaries are denied wholesale; and `lua auth logout` is refused, since it discards a credential nothing here can restore.
- **`/lua-logs` offered a log type that does not exist** (`mastra`, which errors out — framework lines are `runtime`) and told the model to group entries by a `level` field `LogEntry` does not have. The field is `subType`.
- **Four lints were reading the Claude Code layout.** Codex keeps knowledge in `rules/*.mdc`, prompts in `skills/<name>/SKILL.md` and agents in `.toml`, so a scan list naming `lib/knowledge/` and `commands/` walked almost nothing and printed a tick anyway. `lint-log-field-names` had never once read a skill, which is how the `level` bug survived.
- **`lint-cli-flags` forbade `lua sync --pull`**, a real flag. Checked against lua-cli 3.58.0: `--pull` is the documented one and `--accept` is its back-compat alias, so the ban was forcing the wrong spelling.

### New

- **Ten skills**, one per Claude Code slash command that had none: `/lua-browser`, `/lua-decisions`, `/lua-devices`, `/lua-drains`, `/lua-env`, `/lua-integrations`, `/lua-status`, `/lua-template`, `/lua-version`, `/lua-workflow`. Whole product areas were unreachable before.
- **Seven knowledge rules**: `@cli-reference`, `@workflows`, `@decisions`, `@devices`, `@web-apps`, `@browser`, `@log-drains`. An agent asked about any of them previously had nothing to read and answered from memory.
- **Two hooks**: `approve-web-app` (the web-app commands cannot be expressed as a permission glob — `*` matches spaces, so `Bash(npm --prefix src/apps/*/web install)` would also admit an extra package, a second `--prefix` and a `../` path — so anchored regexes in a hook are the rule) and `block-device-secret` (`lua devices credential` without `--out <file>` prints the secret into the transcript).
- **Six lints**: `lint-permissions`, `lint-frontmatter`, `lint-hooks-json`, `lint-single-permission`, `lint-agent-bash-allowlist`, and the production-gate and MCP checks inside `lint-permissions`.
- **Headless mode** (`LUA_PLUGIN_HEADLESS=1`, `lib/headless.mjs`): unattended, no hook message points at a skill, and the `LUA_DEPLOY_CONFIRMED=1` prefix is void — nobody is there to confirm, so the model would be confirming to itself. Nothing blocked interactively is allowed headless.
- **`lua-docs` and `ui` MCP servers** in `.mcp.json`, read-only and allowed tool by tool rather than as whole servers: a remote host can add a tool at any time, and a whole-server rule would pre-approve it unseen.

### Changed

- `@primitives` from 265 lines to 1,085 — it was missing most of the runtime APIs. `@integrations` and `@decision-trees` likewise brought current.
- `/lua-new` accepts all 16 primitive types (was 7): `trigger`, `device`, `device-trigger`, `voice`, `workflow`, `workflow-script`, `webapp`, `decision` and `browser` were unreachable.
- The auth preflight every skill runs is `lua models list --json --ci`, a 1–2 second call with meaningful exit codes, rather than `lua agents`, which walks every organisation and can take 20 seconds or more on a large account.
- The permissions template goes from 26 allow / 6 ask / 8 deny to 121 / 116 / 7, per verb rather than per command family. `lua push device`, `lua push device-trigger` and `lua push browser` ask ABOVE the generic push allow: neither a device nor a browser is versioned, so for those two a push is a go-live.
- `PINNED_MIN_LUA_CLI` 3.12.3 → 3.38.0, the version the rules describe.
- The four build agents (`lua-architect`, `lua-skill-builder`, `lua-deploy-pilot`, `lua-debug`) come up to the current prompts, each with its `## Bash allowlist` cross-checked against the permissions template.
- `lint-knowledge-commands` and `lint-pinned-version` take `LUA_CLI_SRC`, so they can run against a lua-cli checkout outside the monorepo instead of skipping. 1,234 command references now check out against lua-cli 3.58.0, up from 187.
- Tests: 937 in 24 suites, up from 248 in 17.

### Not ported

The `/lua-qa` full-suite harness (`lib/qa/`, 45 modules, 11 playbooks and its five QA sub-agents) is a Claude Code capability this plugin does not have: the sub-agents are drivers for that harness, and without it they are empty shells. `/lua-qa` keeps its existing single-agent flow.

## 1.1.0

Typed CLI auth: `/lua-auth` routes a new login through `lua auth configure` in the user's own terminal, so account details and one-time codes never enter the conversation.

## 1.0.0

First release: the Claude Code plugin ported to Codex CLI — 14 skills, 5 subagents in `agents/*.toml`, 10 hooks, 3 knowledge rules and the read-only `lua-platform` MCP server.
