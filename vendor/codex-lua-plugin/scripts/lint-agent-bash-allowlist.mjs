#!/usr/bin/env node
// Cross-checks each agent's documented `## Bash allowlist` against the rules
// in lib/permissions-template.json.
//
// An agent prompt that lists a command the template does not cover is a
// mid-flow permission prompt waiting to happen: the agent runs the command
// it was told to run, the host has no rule for it, and the user is asked to
// approve something in the middle of a sequence they already authorised.
// That is how `git status --short` and `git log --oneline -5` behaved in the
// Claude Code port — both were in the deploy pilot's allowlist and in no
// permission rule.
//
// Contract: every list item under a `## Bash allowlist` heading in
// agents/*.toml must be matched by at least one allow OR ask rule. Deny is
// deliberately not consulted — a denied command is meant to be refused, and
// the deploy verbs an agent runs are the `LUA_DEPLOY_CONFIRMED=1` forms,
// which are allowed.

import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

const TEMPLATE_PATH = 'lib/permissions-template.json';
const AGENTS_DIR = 'agents';

let template;
try {
  template = JSON.parse(await readFile(TEMPLATE_PATH, 'utf8'));
} catch (err) {
  console.error(`✗ Could not read ${TEMPLATE_PATH}: ${err.message}`);
  process.exit(1);
}

const rules = [
  ...(template?.permissions?.allow ?? []),
  ...(template?.permissions?.ask ?? []),
];

/** `Bash(<glob>)` → the regex the host matches it as. `*` is the only wildcard. */
function patternToMatcher(pattern) {
  const m = pattern.match(/^Bash\((.+)\)$/s);
  if (!m) return null;
  const body = m[1]
    .replace(/[\\^$.+?{}()|[\]]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${body}$`, 's');
}

const matchers = rules.map(patternToMatcher).filter(Boolean);

// The web-app commands are approved by hooks/approve-web-app.mjs with anchored
// regexes rather than by a permission rule, because a glob's `*` matches
// spaces: `Bash(npm --prefix src/apps/*/web install)` would also admit an
// extra package, a second `--prefix` and a `../` path. The hook is the rule
// for those, so this lint consults it too.
const { WEB_APP_COMMAND_RES } = await import('../hooks/approve-web-app.mjs');

const isAllowed = (command) =>
  matchers.some((re) => re.test(command))
  || WEB_APP_COMMAND_RES.some((re) => re.test(command.replace(/<[^>]+>|\bX\b/g, 'app')));

let agentFiles = [];
try {
  agentFiles = (await readdir(AGENTS_DIR)).filter((f) => extname(f) === '.toml');
} catch {
  console.warn('! No agents/ directory; skipping.');
  process.exit(0);
}

let scanned = 0;
for (const file of agentFiles) {
  const path = join(AGENTS_DIR, file);
  const content = await readFile(path, 'utf8');

  // The allowlist lives inside the agent's developer_instructions block, so
  // the heading is matched in the raw file and the block runs to the next
  // heading or to the end of the instructions.
  const blockMatch = content.match(/##\s*Bash\s+allowlist\s*\n+([\s\S]*?)(?=\n#{1,6}\s|\n"""|$)/i);
  if (!blockMatch) continue;

  for (const item of blockMatch[1].matchAll(/^[*-]\s+`([^`]+)`/gm)) {
    const documented = item[1].trim();
    // `[args]` in an agent prompt means "arbitrary trailing arguments"; `*`
    // is a glob the template may also spell. Both become a concrete sample
    // so the rule either covers the shape or does not.
    const sample = documented
      .replace(/\s*\[[^\]]+\]/g, ' anything')
      .replace(/<[^>]+>/g, 'X')
      .replace(/\*/g, 'X');
    if (!isAllowed(sample)) {
      fail(`${path}: documents Bash allowlist entry \`${documented}\` but no allow or ask rule in ${TEMPLATE_PATH} matches it (tested as "${sample}"). Add a rule that covers this command, or every invocation interrupts the flow with a permission prompt.`);
    }
    scanned++;
  }
}

// A silent zero-match is how this class of bug stays invisible: the parser
// finds nothing, the lint prints a tick, and no allowlist is ever checked.
if (scanned === 0 && !failed) {
  fail(`Found 0 documented Bash invocations across ${agentFiles.length} agent file(s). Either no agent declares a "## Bash allowlist" section or the parser is broken. Refusing to pass silently.`);
}

if (failed) {
  console.error('\nFix the issues above and re-run `npm run lint`.');
  process.exit(1);
}
console.log(`✓ Agent Bash allowlists: ${scanned} documented invocation(s) across ${agentFiles.length} agent(s) all match a permission rule.`);
