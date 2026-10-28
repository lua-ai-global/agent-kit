#!/usr/bin/env node
// Validates that the plugin doesn't reference non-existent fields on
// lua-cli's LogEntry type.
//
// Iteration-13 audit: bug 31 found `entry.level === 'error'` in
// hooks/post-deploy-smoke.mjs — but `LogEntry` has no `level` field; the
// field is `subType` (verified against
// packages/lua-cli/src/interfaces/logs.ts). The hook was fixed in
// iteration 13. Iteration 24 found the SAME bug in two agent prompts
// (`agents/lua-deploy-pilot.md`, `agents/lua-qa.md`) — the misnomer
// re-surfaced because nothing pinned the field name to lua-cli's source.
//
// This lint blocks every form: `level=error`, `level === 'error'`,
// `level: 'error'`, `entry.level`, `log.level`. If lua-cli ever adds a
// real `level` field, update this lint to match.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

// The Codex layout: knowledge is rules/*.mdc and prompts are
// skills/<name>/SKILL.md. Neither was on this list, so for the whole life of
// the port this lint scanned agents/, hooks/ and lib/ and never once looked
// at a skill — which is exactly where `Group by level (error / warn / info)`
// sat in skills/lua-logs. `commands/` stays listed so the check keeps
// working if a tree ever has one.
const SCAN_DIRS = ['agents', 'skills', 'rules', 'commands', 'hooks', 'lib'];

// Patterns that are wrong when referring to lua-cli log entries.
// Each pattern + a "near-log" context check (the surrounding text mentions
// "log", "logs", "LogEntry", or `lua logs`).
const BAD_PATTERNS = [
  /\blevel\s*===?\s*['"]error['"]/g,
  /\blevel\s*===?\s*['"]warn['"]/g,
  /\blevel\s*:\s*['"]error['"]/g,
  /\blevel\s*=\s*['"]?error['"]?/g,
  /\b(?:entry|log|item)\.level\b/g,
  /`level=error`|`level=warn`/g,
  // Prose forms. A skill body is a prompt, so "group by level" instructs the
  // model to read a field that does not exist just as surely as code would,
  // and none of the code-shaped patterns above catch it.
  /\b(?:group|grouped|sort|sorted|filter|filtered|bucket|bucketed)\s+(?:them\s+)?by\s+level\b/gi,
  /\blevel\s+field\b/gi,
  /\bthe\s+`?level`?\s+(?:of|on)\s+(?:the\s+)?(?:log|entry|entries)/gi,
];

const LOG_CONTEXT_RE = /\b(log|logs|LogEntry|lua logs|tail_logs)\b/i;

// AGENT_LOG_SOURCES, from the shared types lua-cli imports for its
// `lua logs --type` help text. `lua logs` additionally accepts `all` and
// `calls`, which are not log sources.
//
// A `--type` value the CLI rejects is the same class of bug as a wrong field
// name and was invisible for the same reason: the skill offered `mastra` as
// a log type, which was the agent framework's name long before the source
// was renamed `runtime`, and picking it just errored out. Update this set
// from the source whenever lua-cli adds a source.
const AGENT_LOG_SOURCES = new Set([
  'skill', 'job', 'webhook', 'web-route', 'trigger', 'preprocessor',
  'postprocessor', 'user_message', 'agent_response', 'agent_error',
  'runtime', 'mcp', 'rag', 'device', 'device-trigger', 'model-resolver',
  'workflow-step', 'workflow-script', 'workflow', 'supervision', 'browser',
  'decisions',
]);
const VALID_LOG_TYPES = new Set([...AGENT_LOG_SOURCES, 'all', 'calls']);
// Matches a concrete value only; the `<type>` placeholder in a command
// template is not one.
const LOG_TYPE_RE = /--type\s+`?([a-z][a-z0-9_-]*)`?/g;

// Source names that were never real, or stopped being real. A skill lists
// its log types as a set of options rather than as `--type <value>`, so a
// retired name hides from the check above — which is how `mastra` stayed on
// the menu. Offering one means the user picks it and the CLI errors.
const RETIRED_LOG_SOURCES = {
  mastra: 'runtime (agent runtime / LLM SDK / MCP transport / framework-level logs)',
};
const RETIRED_RE = new RegExp(`\\b(${Object.keys(RETIRED_LOG_SOURCES).join('|')})\\b`, 'gi');
const NEGATION_RE = /\b(?:no|not|never|rejected|refuses|invalid|exits 2|instead of|there is no)\b/i;

async function* walkText(dir) {
  for (const entry of await readdir(dir)) {
    if (entry === 'node_modules' || entry === 'coverage' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) yield* walkText(full);
    else if (st.isFile() && /\.(mjs|md|json)$/.test(full)) yield full;
  }
}

function stripJsComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

let scanned = 0;
for (const target of SCAN_DIRS) {
  try {
    const st = await stat(target);
    const files = st.isDirectory() ? walkText(target) : (async function* () { yield target; })();
    for await (const file of files) {
      let content = await readFile(file, 'utf8');
      // Strip JS comments — audit-history notes legitimately quote the
      // wrong-field forms when explaining the bug.
      if (file.endsWith('.mjs')) content = stripJsComments(content);

      // For markdown, also strip lines that contain "iteration-" or "audit"
      // (history context) AND lines that contain "NOT" near `level` (these
      // are the corrective notes telling the reader NOT to use `level`).
      const lines = content.split('\n');
      const cleaned = lines.filter((line) => {
        if (/iteration-?\d+|audit/i.test(line)) return false;
        if (/\bNOT\b.*\blevel\b|\blevel\b.*\bNOT\b/.test(line)) return false;
        return true;
      }).join('\n');

      if (!LOG_CONTEXT_RE.test(cleaned)) {
        scanned++;
        continue;
      }
      for (const pat of BAD_PATTERNS) {
        const matches = cleaned.match(pat);
        if (matches) {
          fail(`${file}: references nonexistent log-entry field via ${[...new Set(matches)].join(', ')}. The field on lua-cli's LogEntry is \`subType\` (values: 'error' | 'debug' | 'info' | 'warn' | 'start' | 'complete'), NOT \`level\`. Update the prose/code to use \`subType\`.`);
        }
      }
      for (const m of cleaned.matchAll(LOG_TYPE_RE)) {
        const type = m[1];
        if (!VALID_LOG_TYPES.has(type)) {
          fail(`${file}: offers \`lua logs --type ${type}\` but "${type}" is not a log source lua-cli accepts. Valid: all, calls, ${[...AGENT_LOG_SOURCES].join(', ')}.`);
        }
      }
      // A line that tells the reader a source is gone has to be able to name
      // it, the same way the corrective notes about `level` do.
      for (const line of cleaned.split('\n')) {
        if (NEGATION_RE.test(line)) continue;
        for (const m of new Set([...line.matchAll(RETIRED_RE)].map((x) => x[1].toLowerCase()))) {
          fail(`${file}: names "${m}" as a log source, which lua-cli does not accept. Use ${RETIRED_LOG_SOURCES[m]} instead.`);
        }
      }
      scanned++;
    }
  } catch { /* missing — skip */ }
}

// Iteration-13 audit (bug 72 class): fail if zero files were scanned.
if (scanned === 0 && !failed) {
  fail(`Found 0 files to scan in [${SCAN_DIRS.join(', ')}]. Either the directories were renamed/moved, or the file-extension filter is broken. Refusing to silently pass.`);
}

if (failed) {
  console.error('\nFix the issues above and re-run `npm run lint`.');
  process.exit(1);
}
console.log(`✓ No invalid log-entry field references (${scanned} file(s) scanned).`);
