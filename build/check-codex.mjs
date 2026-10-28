#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, emit, rootVersion } from './emit.mjs';
import { compareTrees } from './compare.mjs';

const SNAPSHOT = join(ROOT, 'vendor', 'codex-lua-plugin');
const SNAPSHOT_VERSION = JSON.parse(readFileSync(join(SNAPSHOT, 'package.json'), 'utf8')).version;
const RESIDUALS = JSON.parse(readFileSync(join(ROOT, 'adapters', 'codex', 'residuals.json'), 'utf8')).residuals;

function versionOnly(out, rel, version) {
  const emitted = readFileSync(join(out, rel), 'utf8').split(version).join(SNAPSHOT_VERSION);
  return emitted === readFileSync(join(SNAPSHOT, rel), 'utf8');
}

function observed(result, out, version) {
  const found = new Map();
  for (const rel of result.missing) found.set(rel, 'missing');
  for (const rel of result.extra) found.set(rel, 'extra');
  for (const m of result.mode) found.set(m.rel, 'mode');
  for (const c of result.content) found.set(c.rel, versionOnly(out, c.rel, version) ? 'version' : 'content');
  return found;
}

function audit(found) {
  const problems = [];
  for (const [rel, kind] of found) {
    if (kind === 'version') continue;
    const declared = RESIDUALS[rel];
    if (!declared) problems.push(`undeclared ${kind}: ${rel}`);
    else if (declared.kind !== kind) problems.push(`${rel}: declared ${declared.kind}, observed ${kind}`);
  }
  for (const rel of Object.keys(RESIDUALS)) if (!found.has(rel)) problems.push(`stale declaration (no longer differs): ${rel}`);
  return problems;
}

const version = rootVersion();
const out = mkdtempSync(join(tmpdir(), 'lua-kit-codex-'));
try {
  await emit('codex', out, version);
  const found = observed(compareTrees(SNAPSHOT, out), out, version);
  const problems = audit(found);
  const byCategory = {};
  for (const [rel, kind] of found) {
    const category = kind === 'version' ? 'version-stamp' : RESIDUALS[rel]?.category ?? 'UNDECLARED';
    (byCategory[category] ??= []).push(`${kind.padEnd(8)} ${rel}`);
  }
  for (const [category, rows] of Object.entries(byCategory).sort()) {
    process.stdout.write(`${category} (${rows.length})\n${rows.map((r) => `  ${r}`).join('\n')}\n`);
  }
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\ncodex parity check FAILED\n`);
    process.exit(1);
  }
  process.stdout.write(`codex parity check: ${found.size} path(s) differ from vendor/codex-lua-plugin@03cd4bf; every one is a version stamp or a declared residual\n`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
