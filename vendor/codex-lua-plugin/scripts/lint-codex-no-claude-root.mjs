#!/usr/bin/env node
// Catches `${CLAUDE_PLUGIN_ROOT}` and `${CURSOR_PLUGIN_ROOT}` references
// that slipped through the Claude Code → Cursor → Codex conversion path.
// Codex uses path-relative refs (resolved from the plugin root automatically);
// neither host variable is meaningful here.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

const NEEDLES = ['${CLAUDE_PLUGIN_ROOT}', '${CURSOR_PLUGIN_ROOT}'];
const SCAN_DIRS = ['agents', 'skills', 'rules', 'commands', 'hooks', 'lib', '.codex-plugin', '.mcp.json', 'marketplace.json', 'README.md', 'docs'];
const SCAN_EXT = new Set(['.md', '.mdc', '.json', '.toml', '.mjs', '.js', '.ts']);
const SELF_EXCLUDE = new Set(['lint-codex-no-claude-root.mjs']);

let failed = false;

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.git')) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* walk(path);
    else if (SCAN_EXT.has(extname(e.name))) yield path;
  }
}

let scanned = 0;
for (const target of SCAN_DIRS) {
  try {
    const st = await stat(target);
    const files = st.isDirectory() ? walk(target) : (async function* () { yield target; })();
    for await (const path of files) {
      if (SELF_EXCLUDE.has(basename(path))) continue;
      const content = await readFile(path, 'utf8');
      const isCode = path.endsWith('.mjs') || path.endsWith('.js') || path.endsWith('.ts');
      const stripped = isCode
        ? content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        : content;
      for (const needle of NEEDLES) {
        if (stripped.includes(needle)) {
          console.error(`✗ ${path}: contains stale host variable ${needle}`);
          failed = true;
        }
      }
      scanned++;
    }
  } catch { /* missing — skip */ }
}

if (failed) {
  console.error('\nFix the above. Codex resolves bundled-asset paths relative to the plugin root automatically; no host variable is needed.');
  process.exit(1);
}
console.log(`✓ ${scanned} file(s) scanned; no stale host-variable references.`);
