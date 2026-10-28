#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, emit, rootVersion } from './emit.mjs';
import { compareTrees } from './compare.mjs';
import { auditResiduals, formatByCategory, loadResiduals, observedDifferences } from './residuals.mjs';

const SNAPSHOT = join(ROOT, 'vendor', 'codex-lua-plugin');
const SNAPSHOT_VERSION = JSON.parse(readFileSync(join(SNAPSHOT, 'package.json'), 'utf8')).version;
const DECLARED = loadResiduals(join(ROOT, 'adapters', 'codex', 'residuals.json'));

const version = rootVersion();
const out = mkdtempSync(join(tmpdir(), 'lua-kit-codex-'));
try {
  await emit('codex', out, version);
  const versionOnly = (rel) => readFileSync(join(out, rel), 'utf8').split(version).join(SNAPSHOT_VERSION) === readFileSync(join(SNAPSHOT, rel), 'utf8');
  const found = observedDifferences(compareTrees(SNAPSHOT, out), versionOnly);
  process.stdout.write(`${formatByCategory(found, DECLARED)}\n`);
  const problems = auditResiduals(found, DECLARED);
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\ncodex parity check FAILED\n`);
    process.exit(1);
  }
  process.stdout.write(`codex parity check: ${found.size} path(s) differ from vendor/codex-lua-plugin@03cd4bf; every one is a version stamp or a declared residual\n`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
