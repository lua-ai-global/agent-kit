#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../build/emit.mjs';
import { diffHunks } from '../build/line-diff.mjs';
import { claudePluginReader } from '../build/readers.mjs';
import { glossaryTargets } from '../adapters/codex/adapter.mjs';

const BASE = join(ROOT, 'vendor', 'claude-code-lua-plugin-1.15.0', 'plugins', 'lua-agent-builder');
const TARGET = join(ROOT, 'vendor', 'codex-lua-plugin');
const GLOSSARY = join(ROOT, 'src', 'glossary', 'codex.json');

function count(text, needle) {
  let n = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) n += 1;
  return n;
}

function window(a, hunk, before, after) {
  const start = Math.max(0, hunk.aStart - before);
  const end = Math.min(a.length, hunk.aStart + hunk.removed.length + after);
  const from = a.slice(start, end);
  const to = [...a.slice(start, hunk.aStart), ...hunk.added, ...a.slice(hunk.aStart + hunk.removed.length, end)];
  return { from: from.join('\n'), to: to.join('\n'), size: from.length, exhausted: start === 0 && end === a.length };
}

function pairForHunk(a, hunk, work) {
  for (let grow = 0; ; grow += 1) {
    const w = window(a, hunk, Math.ceil(grow / 2), Math.floor(grow / 2));
    if (w.size > 0 && count(work, w.from) === 1) return { from: w.from, to: w.to };
    if (w.exhausted) throw new Error('no unique anchor for hunk');
  }
}

function derivePairs(base, target) {
  const a = base.split('\n');
  let work = base;
  const pairs = [];
  for (const hunk of diffHunks(a, target.split('\n'))) {
    const pair = pairForHunk(a, hunk, work);
    work = work.replace(pair.from, () => pair.to);
    pairs.push(pair);
  }
  if (work !== target) throw new Error('derived pairs do not reproduce the target');
  return pairs;
}

const current = JSON.parse(readFileSync(GLOSSARY, 'utf8'));
const reader = claudePluginReader(BASE, { hooks: { 'before-shell-execution': join(ROOT, 'packages', 'core', 'hooks', 'before-shell-execution.mjs') } });
const { targets } = glossaryTargets(reader, ROOT);
const files = {};
for (const [path, pairs] of Object.entries(current.files)) {
  if (targets.find((t) => t.path === path)?.derive === false) files[path] = pairs;
}
let total = 0;
for (const t of targets) {
  if (t.derive === false || !existsSync(join(TARGET, t.path))) continue;
  const pairs = derivePairs(t.text, readFileSync(join(TARGET, t.path), 'utf8'));
  if (pairs.length) files[t.path] = pairs;
  total += pairs.length;
}
const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
process.stdout.write(`derive-glossary: ${total} pair(s) over ${Object.keys(sorted).length} file(s) reproduce the parity tree from 1.15.0\n`);
if (process.argv.includes('--write')) {
  writeFileSync(GLOSSARY, `${JSON.stringify({ rules: current.rules, files: sorted }, null, 2)}\n`);
  process.exit(0);
}
const drift = [];
for (const path of new Set([...Object.keys(sorted), ...Object.keys(current.files)])) {
  const derived = JSON.stringify(sorted[path] ?? []);
  const committed = JSON.stringify(current.files[path] ?? []);
  if (derived !== committed) drift.push(path);
}
for (const path of drift) process.stdout.write(`  committed glossary departs from the parity tree: ${path}\n`);
