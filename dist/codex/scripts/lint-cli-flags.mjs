#!/usr/bin/env node
// Denylist of known-wrong or unsafe lua-cli command references that have shipped
// in the plugin. Standalone-repo friendly: doesn't need lua-cli source
// (unlike lint-knowledge-commands.mjs, which is skipped without it).
//
// History:
//   - `lua sync --pull` was banned here for several iterations on the belief
//     that `--accept` was the only real spelling. Re-checked against lua-cli
//     3.58.0's src/cli/command-definitions.ts: BOTH exist, `--pull` is the
//     documented flag ("Pull server state to local without prompting") and
//     `--accept` is declared as "Alias for --pull (kept for backwards
//     compatibility)", with the action reading `opts.pull || opts.accept`.
//     The ban was wrong, so it is gone — a lint that forbids a real flag is
//     a lint that forces the wrong one. lint-knowledge-commands.mjs checks
//     command and subcommand names against that same source, which is the
//     durable version of this check.
//
// Add new entries here whenever a wrong-flag bug ships and gets fixed, and
// verify the claim against command-definitions.ts before adding it. Each
// entry is a literal substring matched against every .md/.json/.mjs file
// under the user-shipped surfaces.

import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DENY = [
  // Pattern → reason
  { pattern: 'lua auth configure --email', reason: 'email and OTP input must stay in a private terminal', authFlow: true },
  { pattern: 'lua auth configure --api-key', reason: 'credentials must stay out of the model conversation', authFlow: true },
  { pattern: 'lua auth configure --otp', reason: 'a one-time code on a command line is a credential in the transcript', authFlow: true },
  { pattern: 'lua auth key --json', reason: 'the API key must never be parsed out of a command the model ran', authFlow: true },
];

const SCAN_DIRS = ['skills', 'agents', 'hooks', 'lib', 'scripts', 'mcp'];
const AUTH_DOC_DIRS = ['docs'];
const AUTH_DOC_FILES = ['README.md', 'SECURITY.md'];
const SCAN_EXT = new Set(['.md', '.json', '.mjs', '.js', '.ts']);

let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* walk(path);
    else if (SCAN_EXT.has(extname(e.name))) yield path;
  }
}

let scanned = 0;
async function scan(path, { authOnly = false } = {}) {
  const content = await readFile(path, 'utf8');
  for (const { pattern, reason, authFlow } of DENY) {
    if (authOnly && !authFlow) continue;
    if (content.includes(pattern)) {
      fail(`${path}: contains denylisted CLI reference \`${pattern}\` — ${reason}`);
    }
  }
  scanned++;
}

for (const dir of SCAN_DIRS) {
  for await (const path of walk(dir)) {
    // Don't lint this script itself — it has to mention the deny patterns.
    if (path.endsWith('lint-cli-flags.mjs')) continue;
    await scan(path);
  }
}
for (const dir of AUTH_DOC_DIRS) {
  for await (const path of walk(dir)) await scan(path, { authOnly: true });
}
for (const path of AUTH_DOC_FILES) await scan(path, { authOnly: true });

if (failed) {
  console.error('\nFix the references above. These commands are wrong or unsafe in a model-run plugin flow.');
  process.exit(1);
}
console.log(`✓ CLI flag denylist: ${scanned} file(s) scanned, no known-wrong flags found.`);
