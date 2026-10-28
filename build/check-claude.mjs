#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERATED_BANNER, ROOT, emit, loadAdapter, rootVersion } from './emit.mjs';
import { compareTrees, formatResult } from './compare.mjs';
import { auditResiduals, formatByCategory, loadResiduals, observedDifferences } from './residuals.mjs';

const SNAPSHOT = join(ROOT, 'vendor', 'claude-code-lua-plugin');
const SNAPSHOT_VERSION = JSON.parse(readFileSync(join(SNAPSHOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins[0].version;
const PROBE_VERSION = '9.9.9-probe';
const DECLARED = loadResiduals(join(ROOT, 'adapters', 'claude-code', 'residuals.json'));

function stripBanners(out, banner) {
  for (const rel of banner) {
    const path = join(out, rel);
    const text = readFileSync(path, 'utf8');
    if (!text.startsWith(GENERATED_BANNER)) throw new Error(`${rel}: generated banner missing`);
    writeFileSync(path, text.slice(GENERATED_BANNER.length));
  }
}

async function emitTo(version, banner) {
  const out = mkdtempSync(join(tmpdir(), 'lua-kit-claude-'));
  await emit('claude-code', out, version);
  stripBanners(out, banner);
  return out;
}

function probeProblems(baseline, probe, stamped) {
  const result = compareTrees(baseline, probe);
  const problems = [...result.missing, ...result.extra, ...result.mode.map((m) => m.rel)].map((rel) => `probe: structural difference at ${rel}`);
  for (const c of result.content) {
    if (!stamped.has(c.rel)) problems.push(`probe: ${c.rel} changes with the version but is not a stamped file`);
    for (const l of c.lines) {
      if (String(l.actual).split(PROBE_VERSION).join(SNAPSHOT_VERSION) !== l.expected) problems.push(`probe: ${c.rel}:${l.line} is not a version-only change`);
    }
  }
  return { problems, lines: result.content.reduce((n, c) => n + c.lines.length, 0), files: result.content.length };
}

const adapter = await loadAdapter('claude-code');
const version = rootVersion();
const stamped = new Set(adapter.stamps.map((s) => s.path).concat(['plugins/lua-agent-builder/.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']));
const exact = await emitTo(version, adapter.banner);
const probe = await emitTo(PROBE_VERSION, adapter.banner);
try {
  const result = compareTrees(SNAPSHOT, exact);
  const versionOnly = (rel) => version !== SNAPSHOT_VERSION && readFileSync(join(exact, rel), 'utf8').split(version).join(SNAPSHOT_VERSION) === readFileSync(join(SNAPSHOT, rel), 'utf8');
  const found = observedDifferences(result, versionOnly);
  if (found.size) process.stdout.write(`${formatByCategory(found, DECLARED)}\n`);
  const p = probeProblems(exact, probe, stamped);
  const problems = [...auditResiduals(found, DECLARED), ...p.problems];
  if (problems.length) {
    process.stderr.write(`${formatResult(result)}\n${problems.join('\n')}\nclaude-code gate FAILED\n`);
    process.exit(1);
  }
  process.stdout.write(
    `claude-code gate: against vendor/claude-code-lua-plugin@3b64bd0 (${SNAPSHOT_VERSION}) the emitted tree differs only by the README banner, version stamps and ${Object.keys(DECLARED.residuals).length} declared residual(s)\n` +
    `claude-code gate: at ${PROBE_VERSION} only version-stamp lines differ (${p.lines} line(s) in ${p.files} file(s))\n`,
  );
} finally {
  rmSync(exact, { recursive: true, force: true });
  rmSync(probe, { recursive: true, force: true });
}
