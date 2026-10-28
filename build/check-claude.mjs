#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERATED_BANNER, ROOT, emit, loadAdapter } from './emit.mjs';
import { compareTrees, formatResult } from './compare.mjs';

const SNAPSHOT = join(ROOT, 'vendor', 'claude-code-lua-plugin');
const SNAPSHOT_VERSION = JSON.parse(readFileSync(join(SNAPSHOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins[0].version;
const PROBE_VERSION = '9.9.9-probe';

function stripBanners(out, banner) {
  for (const rel of banner) {
    const path = join(out, rel);
    const text = readFileSync(path, 'utf8');
    if (!text.startsWith(GENERATED_BANNER)) throw new Error(`${rel}: generated banner missing`);
    writeFileSync(path, text.slice(GENERATED_BANNER.length));
  }
}

function onlyVersionLines(result, stampedPaths) {
  const problems = [];
  for (const c of result.content) {
    if (!stampedPaths.has(c.rel)) problems.push(`${c.rel}: differs but is not a stamped file`);
    for (const l of c.lines) {
      if (String(l.actual).split(PROBE_VERSION).join(SNAPSHOT_VERSION) !== l.expected) {
        problems.push(`${c.rel}:${l.line}: not a version-only change`);
      }
    }
  }
  return problems;
}

async function run(version) {
  const adapter = await loadAdapter('claude-code');
  const out = mkdtempSync(join(tmpdir(), 'lua-kit-claude-'));
  try {
    await emit('claude-code', out, version);
    stripBanners(out, adapter.banner);
    const result = compareTrees(SNAPSHOT, out);
    const structural = [...result.missing, ...result.extra, ...result.mode.map((m) => m.rel)];
    const stamped = new Set(adapter.stamps.map((s) => s.path).concat([
      'plugins/lua-agent-builder/.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
    ]));
    const problems = version === SNAPSHOT_VERSION ? result.content.map((c) => c.rel) : onlyVersionLines(result, stamped);
    return { result, structural, problems, changedFiles: result.content.length, changedLines: result.content.reduce((n, c) => n + c.lines.length, 0) };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const exact = await run(SNAPSHOT_VERSION);
const probe = await run(PROBE_VERSION);
let failed = false;
for (const [label, r] of [[`version ${SNAPSHOT_VERSION}`, exact], [`version ${PROBE_VERSION}`, probe]]) {
  if (r.structural.length || r.problems.length) {
    failed = true;
    process.stderr.write(`${label}:\n${formatResult(r.result)}\n${r.problems.join('\n')}\n`);
  }
}
if (failed) {
  process.stderr.write('claude-code gate FAILED\n');
  process.exit(1);
}
process.stdout.write(
  `claude-code gate: at ${SNAPSHOT_VERSION} the emitted tree is byte-identical to vendor/claude-code-lua-plugin except the README.md banner\n` +
  `claude-code gate: at ${PROBE_VERSION} only version-stamp lines differ (${probe.changedLines} line(s) in ${probe.changedFiles} file(s))\n`,
);
