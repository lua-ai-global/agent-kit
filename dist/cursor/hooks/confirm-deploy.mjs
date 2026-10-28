// PreToolUse / beforeShellExecution hook for every production-affecting
// lua-cli verb.
// Per feature doc §3.3 / tech spec §6.3 row 4.
//
// THIS HOOK IS THE GATE, not a second line. The permission layer cannot
// express "deny the bare verb but allow the prefixed one": a deny or ask rule
// matches past any leading env assignment, so a `Bash(lua deploy*)` deny
// would also block `LUA_DEPLOY_CONFIRMED=1 lua deploy …` and no deploy could
// ever run. lib/permissions-template.json therefore lists only the prefixed
// forms, and a block from this hook takes precedence over any allow rule,
// including a broad `Bash(lua *)` in the user's own settings.
//
// It gates every verb that changes production, not only `lua deploy`. The
// earlier version tested `/\blua\s+deploy\b/` and returned null for anything
// else, so `lua version promote 3` — an atomic swap of the live agent
// version, with no CLI confirmation of its own — `lua skills deploy`,
// `lua mcp activate`, `lua workflows activate`, `lua persona production
// deploy` and `lua marketplace template publish` all went straight through.
// The set lives in lib/tokenizer.mjs, which also knows the CLI's action
// aliases (`publish`, `on`, `enable`, `submit`, `rollout`, …) and the three
// installed binaries (`lua`, `heylua`, `lua-ai`); a glob list here would
// have to be kept in sync with all of that, and a single classifier cannot
// drift. Non-production commands return null immediately.
//
// The classifier reads the WHOLE command — every simple command in a
// `&&`/`;`/`||`/pipe chain, subshells, substitutions, strings run by another
// shell, env-assignment prefixes, launchers (`npx lua`, `pnpm exec lua`,
// `node …/lua`) and binary paths — and accepts the prefix only on the very
// simple command that runs the verb. The regex it replaced was anchored at
// the start of the string, so `cd x && lua deploy all`, `npx lua deploy all`
// and `/usr/local/bin/lua deploy all` were unreachable to it.
//
// Headless (LUA_PLUGIN_HEADLESS=1) the prefix is void: nobody is there to
// confirm, so every production verb is blocked and the block names no skill.
//
// The hook does its own filtering rather than relying on the `matcher` field
// in hooks.json. Matcher semantics vary between hosts, and when the matcher
// did not apply, the old "not prefixed" branch fired for EVERY shell command
// and blocked them all.

import { runHook, checkNodeVersion, isMainScript } from '../lib/hook-runtime.mjs';
import {
  classifyProductionCommand, hasAutoDeploy, UNCLASSIFIABLE_LABEL, MAX_COMMAND_LENGTH,
} from '../lib/tokenizer.mjs';
import { isHeadless } from '../lib/headless.mjs';

const HEADLESS_REASON =
  'This is a headless run (LUA_PLUGIN_HEADLESS=1): nothing here can confirm a production change, so the ' +
  'LUA_DEPLOY_CONFIRMED=1 prefix is not accepted and no deploy, promote, activation or template release ' +
  'runs from this session. Stage the change (lua push, lua version create) and report it; it is made live ' +
  'outside the run. Do not retry with another spelling.';

/**
 * Pure function — exported so tests can import and call directly without
 * the side effects of running as a script (per tech spec §17.1.1).
 *
 * @param {{tool_input?: {command?: string}}|null} input
 * @param {Record<string, string|undefined>} [env] — defaults to process.env (headless switch)
 */
export function decide(input, env = process.env) {
  const command = input?.tool_input?.command ?? '';
  const headless = isHeadless(env);

  if (hasAutoDeploy(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_AUTO: --auto-deploy is never appropriate from inside a model-run session ' +
        '(a granular push would publish as a side effect; lua-cli ignores it for `push all` anyway). ' +
        (headless
          ? HEADLESS_REASON
          : 'Use /lua-deploy instead — it invokes the deploy-pilot agent, which gates each step.'),
    };
  }

  const classified = classifyProductionCommand(command);

  if (!classified) return null;          // Not a production verb — allow

  if (headless) {
    return {
      block: true,
      reason: `DEPLOY_DENIED_HEADLESS: \`${classified.label}\` changes what runs in production. ${HEADLESS_REASON}`,
    };
  }

  if (classified.prefixed) return null;  // User-authorised via the skill flow — allow

  if (classified.label === UNCLASSIFIABLE_LABEL) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_UNCLASSIFIABLE: this command mentions lua but is too long or too complex to check for a ' +
        `production verb (over ${MAX_COMMAND_LENGTH} bytes, or past the classifier's time budget), so it is ` +
        'blocked. Split it into shorter commands, or write long text to a file first and pass the file.',
    };
  }

  return {
    block: true,
    reason:
      `DEPLOY_DENIED_BARE: \`${classified.label}\` changes what runs in production and is blocked without the ` +
      `LUA_DEPLOY_CONFIRMED=1 prefix. Use ${classified.slash} (it collects your single confirmation per the ` +
      '§3.7 contract, then emits the prefixed form). The prefix counts only as the first word of the simple ' +
      'command that runs the verb, with the binary spelled `lua` — not in a pipe, subshell, `$(…)`, ' +
      '`bash -c` string, or through npx/pnpm/node/a path, and it confirms only that one command in a chain.',
  };
}

// Script entry point — only fires when Claude Code invokes this file directly.
// Test imports skip this block, avoiding the `process.exit` that runHook calls.
//
// Coverage note (architect review I2): the spawn-based integration test
// (test/hooks/confirm-deploy.integration.test.mjs) verifies this block runs
// correctly end-to-end, but Jest's coverage collector measures the parent
// process — child-process coverage merging would require NODE_V8_COVERAGE
// plumbing disproportionate to the value. The integration test is the
// per-§17.1.1 smoke check for entry-point wiring; istanbul ignores the
// uninstrumented lines.
/* istanbul ignore next */
if (isMainScript(import.meta.url)) {
  checkNodeVersion();
  await runHook('confirm-deploy', decide);
}
