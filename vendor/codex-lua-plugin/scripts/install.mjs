#!/usr/bin/env node
// Install the plugin into Codex CLI.
//
// Codex has first-class plugin install: `codex plugin marketplace add` +
// `codex plugin install`. The plugin source lives in this repo; Codex
// caches it at ~/.codex/plugins/cache/<marketplace>/<name>/<version>/.
//
// This script:
//   1. Pre-flight: ensure mcp/lua-platform/dist/server.js exists (gitignored)
//   2. Pre-flight: ensure `codex` CLI is on PATH; if not, print install hint
//   3. Register this repo as a Codex marketplace
//   4. Trigger plugin install — Codex copies the plugin into its cache
//      and registers skills/hooks/MCP from the manifest
//
// Usage (after `git clone` + `cd mcp/lua-platform && npm ci && npm run build`):
//   node scripts/install.mjs              # install
//   node scripts/install.mjs --uninstall  # remove

import { stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const isUninstall = process.argv.includes('--uninstall');

const log = (msg) => console.log(msg);
const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → exit ${r.status}`);
  }
}

function tryRun(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'pipe' }).status === 0;
}

async function preflight() {
  if (!isUninstall) {
    const bundle = `${PLUGIN_ROOT}/mcp/lua-platform/dist/server.js`;
    try { await stat(bundle); }
    catch {
      fail(
        `MCP server bundle not found at ${bundle}.\n` +
        `Build it first:\n  cd ${PLUGIN_ROOT}/mcp/lua-platform && npm ci && npm run build`
      );
    }
  }

  if (!tryRun('codex', ['--version'])) {
    fail(
      `Codex CLI not on PATH. Install it first:\n` +
      `  npm install -g @openai/codex\n` +
      `Then re-run this script.`
    );
  }
}

await preflight();

log('');
log(isUninstall
  ? `Uninstalling lua-agent-builder from Codex CLI`
  : `Installing lua-agent-builder into Codex CLI (source: ${PLUGIN_ROOT})`);
log('');

if (isUninstall) {
  try {
    run('codex', ['plugin', 'uninstall', 'lua-agent-builder']);
    ok('Uninstalled lua-agent-builder.');
  } catch (e) {
    log(`  (codex plugin uninstall reported: ${e.message} — likely already removed)`);
  }
  try {
    run('codex', ['plugin', 'marketplace', 'remove', 'lua-ai-marketplace']);
    ok('Removed lua-ai-marketplace from Codex marketplaces.');
  } catch (e) {
    log(`  (codex plugin marketplace remove reported: ${e.message} — likely already gone)`);
  }
} else {
  // 1. Register this repo as a marketplace (idempotent — Codex no-ops if already added)
  try {
    run('codex', ['plugin', 'marketplace', 'add', PLUGIN_ROOT]);
    ok(`Registered lua-ai-marketplace from ${PLUGIN_ROOT}`);
  } catch (e) {
    fail(`Failed to register marketplace: ${e.message}`);
  }

  // 2. Install the plugin from the registered marketplace
  try {
    run('codex', ['plugin', 'install', 'lua-agent-builder']);
    ok('Installed lua-agent-builder.');
  } catch (e) {
    fail(`Failed to install plugin: ${e.message}`);
  }
}

log('');
ok(isUninstall ? 'Uninstall complete.' : 'Install complete.');
log('');
log('NEXT: in Codex, type "/" to see the lua-* skills appear in autocomplete.');
log('Run /lua-doctor to verify the full environment, or /lua-auth to authenticate.');
log('');
