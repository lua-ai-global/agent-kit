#!/usr/bin/env node
// Validates hooks/hooks.json: the event names, the field names, the shape of
// every `if` filter, and that the file and the hooks/ directory agree about
// which scripts exist.
//
// Two failures this exists for.
//
// An `if` filter written in regex syntax. The host reads `if` as a
// permission-rule glob, the same format as a permissions rule, where `*` is
// the only wildcard. The Claude Code port wrote all five of its conditional
// filters as regexes (`^`, `\s`, `(?:…)`, `|`), so none of them ever matched
// and every conditional hook silently never fired.
//
// A script in hooks/ that no event references. The host only ever spawns
// what the registry names, so an unregistered hook is a file that looks like
// a working safety gate and runs never. The reverse — a registry entry whose
// file is missing — fails the spawn at runtime instead.

import { readFile, readdir } from 'node:fs/promises';

let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

const HOOKS_PATH = 'hooks/hooks.json';

let doc;
try {
  doc = JSON.parse(await readFile(HOOKS_PATH, 'utf8'));
} catch (err) {
  console.error(`✗ Could not read ${HOOKS_PATH}: ${err.message}. Without this file no hook is ever invoked.`);
  process.exit(1);
}

const VALID_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse',
  'PostToolUse', 'Stop', 'SubagentStop', 'PreCompact', 'Notification',
]);

const VALID_HOOK_FIELDS = new Set(['type', 'command', 'if', 'timeout']);
const VALID_MATCHER_FIELDS = new Set(['matcher', 'hooks']);

// Metacharacters with no glob meaning. `.*` is left alone: a literal dot
// followed by the `*` wildcard is a legitimate glob.
const REGEX_ONLY = /[\^$\\]|\(\?[:=!]/;

const events = doc?.hooks;
if (!events || typeof events !== 'object') {
  console.error(`✗ ${HOOKS_PATH}: top-level "hooks" object is missing.`);
  process.exit(1);
}

const referencedFiles = new Set();
let hookCount = 0;

for (const [event, entries] of Object.entries(events)) {
  if (!VALID_EVENTS.has(event)) {
    fail(`${HOOKS_PATH}: unknown event "${event}". Valid: ${[...VALID_EVENTS].join(', ')}.`);
    continue;
  }
  if (!Array.isArray(entries)) {
    fail(`${HOOKS_PATH}: hooks.${event} must be an array.`);
    continue;
  }
  for (const matcherEntry of entries) {
    for (const key of Object.keys(matcherEntry ?? {})) {
      if (!VALID_MATCHER_FIELDS.has(key)) {
        fail(`${HOOKS_PATH}: hooks.${event}[] has unknown matcher field "${key}". Valid: ${[...VALID_MATCHER_FIELDS].join(', ')}.`);
      }
    }
    const hooksList = matcherEntry?.hooks;
    if (!Array.isArray(hooksList)) {
      fail(`${HOOKS_PATH}: hooks.${event}[].hooks must be an array.`);
      continue;
    }
    for (const hook of hooksList) {
      hookCount++;
      for (const key of Object.keys(hook ?? {})) {
        if (!VALID_HOOK_FIELDS.has(key)) {
          fail(`${HOOKS_PATH}: hooks.${event}[].hooks[] has unknown hook field "${key}". Valid: ${[...VALID_HOOK_FIELDS].join(', ')}.`);
        }
      }
      if (hook?.type !== 'command') {
        fail(`${HOOKS_PATH}: a hook in ${event} is missing type:"command" (got ${JSON.stringify(hook?.type)}).`);
      }
      if (typeof hook?.command !== 'string') {
        fail(`${HOOKS_PATH}: a hook in ${event} is missing a string command.`);
      } else {
        const match = hook.command.match(/(hooks\/[a-z0-9-]+\.mjs)/);
        if (match) referencedFiles.add(match[1]);
        else fail(`${HOOKS_PATH}: hook command "${hook.command}" does not reference a hooks/<name>.mjs script.`);
      }
      if (hook && 'timeout' in hook && (typeof hook.timeout !== 'number' || hook.timeout <= 0)) {
        fail(`${HOOKS_PATH}: a hook in ${event} has an invalid timeout=${JSON.stringify(hook.timeout)}.`);
      }
      if (typeof hook?.if === 'string') {
        const m = hook.if.match(/^([A-Z][A-Za-z]*)\((.+)\)$/s);
        if (!m) {
          fail(`${HOOKS_PATH}: hook.if "${hook.if}" is not of the form Tool(payload), for example Bash(lua deploy*).`);
        } else if (REGEX_ONLY.test(m[2])) {
          fail(`${HOOKS_PATH}: hook.if "${hook.if}" contains regex-only metacharacters. The host reads \`if\` as a permission glob where \`*\` is the only wildcard, so this filter never matches. Rewrite it with \`*\`, for example Bash(*--auto-deploy*).`);
        }
      }
    }
  }
}

let onDisk = [];
try {
  onDisk = (await readdir('hooks')).filter((f) => f.endsWith('.mjs')).map((f) => `hooks/${f}`);
} catch {
  fail('hooks/ directory is missing.');
}

for (const file of onDisk) {
  if (!referencedFiles.has(file)) {
    fail(`${file} exists but no event in ${HOOKS_PATH} references it, so it is never invoked. Register it or delete it.`);
  }
}
for (const file of referencedFiles) {
  if (!onDisk.includes(file)) {
    fail(`${HOOKS_PATH} references ${file} but that file does not exist, so the host fails to spawn it.`);
  }
}

if (hookCount === 0 && !failed) {
  fail(`${HOOKS_PATH} registers 0 hooks. Refusing to pass silently.`);
}

if (failed) {
  console.error('\nFix the issues above and re-run `npm run lint`.');
  process.exit(1);
}
console.log(`✓ ${HOOKS_PATH}: ${hookCount} hook registration(s) valid; ${onDisk.length} script(s) on disk all registered.`);
