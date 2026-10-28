#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, emit } from './emit.mjs';
import { compareTrees, formatResult, isClean } from './compare.mjs';

const SNAPSHOT = join(ROOT, 'vendor', 'claude-code-lua-plugin');

const out = mkdtempSync(join(tmpdir(), 'lua-kit-claude-'));
try {
  await emit('claude-code', out);
  const result = compareTrees(SNAPSHOT, out);
  if (!isClean(result)) {
    process.stderr.write(`${formatResult(result)}\nclaude-code: emitted tree differs from vendor/claude-code-lua-plugin\n`);
    process.exit(1);
  }
  process.stdout.write('claude-code: emitted tree is byte-identical to vendor/claude-code-lua-plugin (contents and modes)\n');
} finally {
  rmSync(out, { recursive: true, force: true });
}
