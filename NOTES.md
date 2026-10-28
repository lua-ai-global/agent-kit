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
8. `lua sync --accept`. lua-cli's `command-definitions.ts` defines it as "Alias for --pull (kept for backwards compatibility)": it pulls server state into local files and writes nothing to the platform. Decision: it takes the `--pull` tiers on every host, `lua sync --accept*` allow and `lua sync --accept --force*` ask. The only host-scoped rows left are the two QA-helper rows, which stay Claude-only because the QA harness and the `guard-qa-helper` hook that makes the allow glob safe ship only there; every host-scoped row must now carry a `reason`, and the test fails otherwise.
9. `lint-knowledge-commands` against the local `lua-core-services` checkout (lua-cli 3.44.0) fails on `lua browser`, `lua browsers` and `lua decisions`: the checkout is older than the knowledge base. The same happens on the upstream repo; it needs a current lua-cli checkout, not a kit change.
10. Codex agents lose the Claude `tools:` allowlist: TOML has no field for it. The doctor should say so.
11. Claude `lib/hook-runtime.mjs` `isMainScript()` compares `resolve()` paths, but Node resolves the main module through symlinks. When the plugin path crosses a symlink (a symlinked HOME, `/var` on macOS, a marketplace registered through a symlinked directory), every hook silently does nothing, and the deploy gate is off. The installer's doctor self-test caught this: a marketplace registered at `~/.lua/agent-kit/current/claude-code` let a bare `lua deploy all` through. Fixed: there is now one runtime, `packages/core/lib/hook-runtime.mjs`, on every host, Claude Code included, and `isMainScript()` compares real paths. `test/lib/hook-runtime-symlink.test.mjs` runs the gate through a symlinked plugin path under each host payload, and an installer test runs it through both the real version path and the `current` symlink. The installer keeps registering the real path.
12. A hook warning on Cursor rendered `{permission: "allow"}`, which can auto-approve the command. Decision: a warning maps to `ask`, the one non-approving permission Cursor has that does not block; the message goes to both `user_message` and `agent_message`. A test asserts that no host renders a warning as an approval.

## Installer

- `packages/installer` is `@lua-ai-global/agent-kit` (`bin: agent-kit`). It is packed with `npm pack`, never published.
- Hub: `~/.lua/agent-kit/<version>/` (or `$XDG_DATA_HOME/lua/agent-kit`), `current` is a relative symlink to the version, `installed.json` records every path written. Skill links point at `current/skills/<name>`, so `update` and rollback switch all of them with one rename.
- Plugins go through the hosts' own CLIs at the real version path: `claude plugin marketplace add` plus `claude plugin install`, `codex plugin marketplace add` plus `codex plugin add`. A marketplace of the same name from anywhere else is reported and left alone. Update and rollback remove and re-add the marketplace at the new version path.
- npm drops `.gitignore` and `.npmrc` from a package, so the payload stores them as `<name>.agent-kit-dotfile` and the hub restores them; the hub trees are byte-identical to `dist/`.
- Detection reads the config directory and looks for the binary on PATH without running it: running `grok --version` creates `~/.grok`.
- `doctor` never reads a credential value. It reports which sources exist (`env`, a `.env` file, a session file, the credentials file) by presence only.
- Universal skills (`dist/universal`, mirrored to the repo's `skills/`) are the Tier C build: spec frontmatter, a Tier C notice at the top of every skill, Claude-only vocabulary rewritten by `src/glossary/universal.json`, knowledge and agent briefs under `lua-agent-builder/references/`. `lua-qa` is left out (the QA harness is Claude-only).
- Known overlap: Codex reads `~/.agents/skills`, so a Codex user with the plugin also sees the universal skills. They are print-only, so the overlap is safe but duplicated.
- Not done: detecting network or FAT mounts for the copy fallback; Windows was not run (the copy path is exercised with `LUA_AGENT_KIT_NO_SYMLINKS=1`).

## Cursor

- `dist/cursor` is the hook bundle: the six shell hooks from core (`beforeShellExecution`), the multi-host runtime with `DEFAULT_HOST = 'cursor'`, the MCP bundle, and `cursor-hooks.json` / `cursor-mcp.json` templates. The installer renders them with the real hub path into `~/.cursor/hooks.json` and `~/.cursor/mcp.json` (or `.cursor/` with `--project`) only when those files do not exist; an existing file is never edited, the rendered one is left next to the hub for the user to merge, and doctor reports Cursor as Tier C until it is.
- `failClosed: true` is set on `before-shell-execution` and `confirm-deploy`, and the runtime blocks instead of failing open when one of those two hooks throws on Cursor (`FAIL_CLOSED_HOOKS` in `lib/host-default.mjs`). Every other hook, and every hook on Claude Code and Codex, still fails open.
- Not registered on Cursor: the SessionStart hooks (version, project detection, auth), `inject-context` and the two PostToolUse hooks. Their input and output contracts on Cursor were not verified.
- A hook `warn` renders `{permission: "ask"}` on Cursor (bug 12), so `warn-version-zero` asks before a `--set-version 0.x` push instead of approving it.
- Cursor reads its skills from `~/.cursor/skills`; they are the universal Tier C skills, so their notice ("no hook can stop a command") is conservative once the Cursor hooks are armed.
- Not run in a real Cursor session: no `cursor-agent` binary on this machine. The hooks were run as processes with Cursor's payload and environment (`test/cursor-dist.test.mjs`).

## Cross-adapter lint

`build/parity.mjs` implements clauses 1 (one tokenizer, byte-identical in every tree), 5 (no foreign host token in shipped files) and 6 (no dropped skill or rule) of the scope's seven. Clauses 2 (one rules digest), 3 (every gated verb enforced or waived per host), 4 (no bare production verb or `--auto-deploy` in any output) and 7 (permissions-mirror against every adapter) are not built yet; the Claude and Codex trees each still run their own `permissions-mirror` test.

## Deferred

- The 6 KB permission `_comment` is still one string per host (`src/permissions/comment.<host>.json`), kept verbatim so the Claude template stays byte-identical. Splitting it into per-row rationale changes the emitted template.
- `hooks/before-shell-execution.mjs` keeps its hand-written rules. Generating them from the deny tier of `rules.json` changes the Codex tree.
- Lints are not yet one-per-concern: four identical scripts are shared from `tools/lint/`, the rest stay per adapter in `adapters/<host>/templates/scripts/`.
- The kit version stays 1.16.0. The 2.0.0 cut-over belongs to step 7, which needs pushes.
- `tools/derive-glossary.mjs --write` regenerates the Codex per-file pairs from the parity tree and would undo the three skill fixes above. Run it without `--write` to see where the committed glossary departs from the parity tree.
