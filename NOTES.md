# Build notes

Local-only build of the agent kit. No remote, no push, no publish.

## Sources

- Claude Code: `claude-code-lua-plugin@3b64bd0` (1.16.0), vendored at `vendor/claude-code-lua-plugin/`.
- Codex: `codex-lua-plugin` branch `feat/parity-with-claude-plugin@03cd4bf` (1.2.0), vendored at `vendor/codex-lua-plugin/`. The credfix commit (`6345bc2`, `fix/credential-permissions`) is already in that branch's history; merging `fix/credential-permissions` into it changes no file.
- Claude 1.15.0 (`d0347bf`), the release the parity branch was cut against, vendored at `vendor/claude-code-lua-plugin-1.15.0/`. It is only used to check the Codex glossary.

## Checks

| Check | Command | What it proves |
| --- | --- | --- |
| Claude gate | `node build/check-claude.mjs` | `dist/claude-code` differs from the 1.16.0 snapshot only by the README banner, version stamps and the residuals declared in `adapters/claude-code/residuals.json`; a probe version changes only stamp lines |
| Codex parity | `node build/check-codex.mjs` | every path that differs from the parity tree is a version stamp or is declared in `adapters/codex/residuals.json` |
| Glossary fidelity | `node tools/derive-glossary.mjs` | the Codex glossary applied to Claude 1.15.0 reproduces the parity tree, except the three parity bugs below |
| Suites | `build/test-dist.sh claude-code plugins/lua-agent-builder`, `build/test-dist.sh codex ""` | each emitted tree's own lint, coverage suite and MCP suite pass in a throwaway copy |
| Core | `npm run test:core` | shared hook tests once per host profile, and the shipped hooks as real processes under each host |

## Codex residuals

Every residual is in `adapters/codex/residuals.json` with its reason. By category:

- `claude-1.16` (6): `/lua-audit`, the `lua-auditor` agent, the web-app audit hint in `inject-context`, and the 1.16.0 lines in `web-apps` and `lua-new`. The parity branch is a 1.15.0 port.
- `canonical-newer` (29): the kit ships one copy of shared code. `lib/credentials.mjs` is the 4-tier resolver, as the scope decides. The MCP server is the Claude one, with its bundle committed.
- `tests-superset` (4): the canonical suites are supersets of the Codex copies.
- `host-runtime` (4): `lib/hook-runtime.mjs` is the multi-host runtime over `lib/host.mjs`. The parity runtime's own test file passes unchanged against it.
- `tokenizer-verbatim` (1): three comment sentences. The tokenizer is byte-identical to core on every host.
- `stale-dropped` (3): `lib/knowledge/{decision-trees,integrations,primitives}.md`, unreferenced v1.0.0 copies superseded by `rules/*.mdc`.
- `parity-bug-fixed` (4): see below.
- Version stamps (2): `.codex-plugin/plugin.json` and `package.json` carry the kit version.

## Bugs found

Fixed by the generator (the generated tree no longer has them):

1. Codex `skills/lua-deploy/SKILL.md` points at `agents/agents/lua-deploy-pilot.md`, which does not exist. The generator emits `agents/lua-deploy-pilot.toml`.
2. Codex `skills/lua-test/SKILL.md` and `skills/lua-workflow/SKILL.md` kept the Claude-only `subagent_type:` key. The generator emits `agent:`.
3. Codex install is broken on codex-cli 0.154: `codex plugin marketplace add <repo>` rejects the root `marketplace.json` ("marketplace root does not contain a supported manifest"), and its `{type: "path"}` source lists no plugin. The kit adds `.agents/plugins/marketplace.json` with a `{source: "local"}` source; `marketplace add` plus `plugin add` then install under a throwaway `CODEX_HOME`.
4. Codex `mcp/lua-platform/.gitignore` ignored `dist/`, so a marketplace install had no `dist/server.js` for `.mcp.json` to launch unless the user built it. The kit commits the bundle.
5. The Codex MCP server only knew the 3-tier credential chain, so it failed for every lua-cli session login (the default since lua-cli 3.29). The kit ships the canonical server.

Fixed in the kit after JM's decision that the live plugins are sunset (each is a declared residual in `adapters/claude-code/residuals.json` and/or `adapters/codex/residuals.json`, so the Claude gate checks them against the 1.16.0 baseline instead of requiring byte equality):

6. `hooks/block-auth-configure.mjs` matched `\blua\s+auth\s+configure` and missed `heylua auth configure` and `lua-ai auth configure`. Both credential hooks now use `packages/core/lib/lua-bin.mjs`: `lua`, `heylua`, `lua-ai` and `lua-cli`, after a path, a launcher (`npx`, `pnpm exec`), a quote or `$(`, with `.cmd`/`.exe`/`.js` extensions, any case. A test checks the alias list against the names the deploy classifier recognises.
7. Hook timeouts. Decision: one value per hook in `src/hooks/registry.json`, used by every host; `timeoutBy` is gone and `test/consistency.test.mjs` fails if it comes back. `confirm-deploy` is 30 s everywhere (Claude had 10 s, Codex 30 s): on every host a timed-out hook fails open, so for the gate the longer budget is the safe one, and the classifier itself stops at its 1.5 s budget long before. `check-lua-auth` is 20 s everywhere (Codex had 15 s): it is a SessionStart probe, a longer budget costs nothing, and Claude had already raised it for large accounts.
8. `lua sync --accept`. lua-cli's `command-definitions.ts` defines it as "Alias for --pull (kept for backwards compatibility)": it pulls server state into local files and writes nothing to the platform. Decision: the rule set is identical on every host, and `--accept` has no row anywhere, so it falls to the host's own prompt. Adding it to Claude (the first attempt) failed Claude's `lint-cli-flags`, which denylists `lua sync --accept` as a legacy spelling the plugin must not emit; the plugin only ever emits `--pull`, which keeps its allow and its `--pull --force` ask on every host. Dropping a pre-approval is the safe direction. The only host-scoped rows left are the two QA-helper rows, which stay Claude-only because the QA harness and the `guard-qa-helper` hook that makes the allow glob safe ship only there; every host-scoped row must now carry a `reason`, and the test fails otherwise.
9. `lint-knowledge-commands` against the local `lua-core-services` checkout (lua-cli 3.44.0) fails on `lua browser`, `lua browsers` and `lua decisions`: the checkout is older than the knowledge base. The same happens on the upstream repo; it needs a current lua-cli checkout, not a kit change.
10. Codex agents lose the Claude `tools:` allowlist: TOML has no field for it. The doctor should say so.
11. Claude `lib/hook-runtime.mjs` `isMainScript()` compares `resolve()` paths, but Node resolves the main module through symlinks. When the plugin path crosses a symlink (a symlinked HOME, `/var` on macOS, a marketplace registered through a symlinked directory), every hook silently does nothing, and the deploy gate is off. The installer's doctor self-test caught this: a marketplace registered at `~/.lua/agent-kit/current/claude-code` let a bare `lua deploy all` through. Fixed: there is now one runtime, `packages/core/lib/hook-runtime.mjs`, on every host, Claude Code included, and `isMainScript()` compares real paths. `test/lib/hook-runtime-symlink.test.mjs` runs the gate through a symlinked plugin path under each host payload, and an installer test runs it through both the real version path and the `current` symlink. The installer keeps registering the real path.
12. A hook warning on Cursor rendered `{permission: "allow"}`, which can auto-approve the command. Decision: a warning maps to `ask`, the one non-approving permission Cursor has that does not block; the message goes to both `user_message` and `agent_message`. A test asserts that no host renders a warning as an approval.
13. On Cursor, a `failClosed` hook that prints nothing counts as a failed hook, so the two gate hooks blocked every shell command, `ls` included (found by running Cursor's own hook executor). Fixed: on Cursor a hook with no decision prints `{}`, a valid response with no permission, which neither blocks nor approves. Claude Code and Codex still print nothing.

## Distribution

- There is no installer package. The repo itself is the install source:
  - skills for every agent: `npx skills add lua-ai-global/agent-kit` reads the root `skills/` folder (the universal build);
  - Claude Code plugin: `claude plugin marketplace add lua-ai-global/agent-kit`, catalog `.claude-plugin/marketplace.json` (`lua-ai`), plugin at `dist/claude-code/plugins/lua-agent-builder`;
  - Codex plugin: `codex plugin marketplace add lua-ai-global/agent-kit`, catalog `.agents/plugins/marketplace.json` (`lua-ai`), plugin at `dist/codex`;
  - Cursor plugin: `agent plugin marketplace add https://github.com/lua-ai-global/agent-kit`, then install `lua-agent-builder` from `/plugins` (CLI) or Customize (app). Catalog `.cursor-plugin/marketplace.json` (`lua-ai`), plugin at `dist/cursor`. The CLI needs the full URL: a bare `owner/repo` is read as a host name. Adding a marketplace needs a signed-in Cursor account (the catalog is registered server-side), and the CLI has no non-interactive `plugin install`.
- Codex 0.154 only resolves a catalog entry whose `source` is `{ "source": "local", "path": … }` or a plain path string; `{ "type": "path", … }` installs nothing ("plugin was not found in marketplace"). Codex also skips marketplaces that live under the system temp folder, so test from a normal folder.
- The npm package `lua-agent-kit` 2.0.0-beta.0 (published 2026-11-01 with the old installer) is deprecated in favour of the commands above.
- Universal skills (`dist/universal`, mirrored to the repo's `skills/`) are the Tier C build: spec frontmatter, a Tier C notice at the top of every skill, Claude-only vocabulary rewritten by `src/glossary/universal.json`, knowledge and agent briefs under `lua-agent-builder/references/`. `lua-qa` is left out (the QA harness is Claude-only).
- Known overlap: Codex reads `~/.agents/skills`, so a Codex user with the plugin also sees the universal skills. They are print-only, so the overlap is safe but duplicated.
- Not done: detecting network or FAT mounts for the copy fallback; Windows was not run (the copy path is exercised with `LUA_AGENT_KIT_NO_SYMLINKS=1`).

## Cursor

- `dist/cursor` is a Cursor Plugin (cursor.com/docs/reference/plugins): `.cursor-plugin/plugin.json`, `hooks/hooks.json` with the six shell hooks from core (`beforeShellExecution`), `mcp.json`, the multi-host runtime with `DEFAULT_HOST = 'cursor'` and the MCP bundle. Components are found by Cursor's default folder discovery; the manifest names no paths.
- Hook commands are `node ./hooks/<hook>.mjs`. Cursor runs a plugin's hooks from the plugin's install folder (except `stop` and `subagentStop`), so the relative path also works where `$CURSOR_PLUGIN_ROOT` would not expand (PowerShell). The MCP server uses `${CURSOR_PLUGIN_ROOT}`, which Cursor itself expands in `command`, `args`, `env` and `cwd`.
- `lua-platform` gets no `env` block on Cursor. In plugin MCP config Cursor leaves an unresolved `${env:LUA_API_KEY}` as the literal string, and the credential resolver would take that as the key; without the block the server inherits the environment and falls through to the lua-cli session login.
- Cursor also reads `.claude-plugin/marketplace.json`, but `.cursor-plugin/marketplace.json` is checked first, so Cursor gets the Cursor build.
- `failClosed: true` is set on `before-shell-execution` and `confirm-deploy`, and the runtime blocks instead of failing open when one of those two hooks throws on Cursor (`FAIL_CLOSED_HOOKS` in `lib/host-default.mjs`). Every other hook, and every hook on Claude Code and Codex, still fails open.
- Not registered on Cursor: the SessionStart hooks (version, project detection, auth), `inject-context` and the two PostToolUse hooks. Their input and output contracts on Cursor were not verified.
- A hook `warn` renders `{permission: "ask"}` on Cursor (bug 12), so `warn-version-zero` asks before a `--set-version 0.x` push instead of approving it.
- Cursor reads its skills from `~/.cursor/skills`; they are the universal Tier C skills, so their notice ("no hook can stop a command") is conservative once the Cursor hooks are armed.
- Checked against Cursor's own code (cursor-agent 2026.11.05-86047df, installed under a throwaway HOME): its marketplace parser reads the repo catalog and finds `lua-agent-builder` at `dist/cursor` with the `beforeShellExecution` hooks and the three MCP servers; its plugin loader loads the plugin from `~/.cursor/plugins/local` and expands the MCP path; its hook executor, given the loaded plugin, denies `lua deploy all`, `lua auth key`, `npx heylua auth configure` and `--auto-deploy`, and lets `ls -la` and the confirmed deploy through. Not run: a model-driven agent session (no Cursor login on this machine) and the Cursor app.

## Cross-adapter lint

`build/parity.mjs` runs all seven clauses over `dist/` and prints the `rules.json` digest; `test/parity.test.mjs` proves each new clause fails on injected drift.

1. Every tree's `lib/tokenizer.mjs` is byte-identical to core's.
2. Every emitted permission template equals `src/permissions/rules.json` filtered for its host, tier by tier.
3. Every production verb in the tokenizer (`PRODUCTION_COMMANDS`) is blocked by the emitted hooks of Claude Code, Codex and Cursor, imported from each tree; on the universal tree it must be named in the Tier C notice (the waiver in `src/permissions/waivers.json`).
4. No `` `Bash(…)` `` command in any skill, agent or rule runs a bare production verb or `--auto-deploy`. Permission-rule examples (with `*`) and placeholder syntax the classifier cannot resolve are skipped.
5. No foreign host token in shipped files.
6. No dropped skill or rule.
7. Every tree with a permission template ships `test/lib/permissions-mirror.test.mjs`, and on the hook-only hosts (Codex, Cursor) every deny-tier row is enforced by a registered hook, except `Bash(heylua *)` and `Bash(lua-ai *)`, waived with a reason in `src/permissions/waivers.json` because the hooks match those names per verb.

Not built: compiling Codex ask-tier rows into a PermissionRequest hook or a deny-with-instruction. Today the ask tier on Codex falls to Codex's own approval prompt.

## Deferred

- The 6 KB permission `_comment` is still one string per host (`src/permissions/comment.<host>.json`), kept verbatim so the Claude template stays byte-identical. Splitting it into per-row rationale changes the emitted template.
- `hooks/before-shell-execution.mjs` keeps its hand-written rules. Generating them from the deny tier of `rules.json` changes the Codex tree.
- Lints are not yet one-per-concern: four identical scripts are shared from `tools/lint/`, the rest stay per adapter in `adapters/<host>/templates/scripts/`.
- The kit version stays 1.16.0. The 2.0.0 cut-over belongs to step 7, which needs pushes.
- `tools/derive-glossary.mjs --write` regenerates the Codex per-file pairs from the parity tree and would undo the three skill fixes above. Run it without `--write` to see where the committed glossary departs from the parity tree.
