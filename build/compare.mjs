import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function listTree(root, rel = '', out = new Map()) {
  for (const entry of readdirSync(join(root, rel)).sort()) {
    if (entry === 'node_modules' || entry === 'coverage') continue;
    const relPath = rel ? `${rel}/${entry}` : entry;
    const st = statSync(join(root, relPath));
    if (st.isDirectory()) listTree(root, relPath, out);
    else out.set(relPath, st.mode & 0o777);
  }
  return out;
}

function diffLines(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  const changed = [];
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    if (left[i] !== right[i]) changed.push({ line: i + 1, expected: left[i], actual: right[i] });
  }
  return changed;
}

export function compareTrees(expectedRoot, actualRoot) {
  const expected = listTree(expectedRoot);
  const actual = listTree(actualRoot);
  const result = { missing: [], extra: [], mode: [], content: [] };
  for (const [rel, mode] of expected) {
    if (!actual.has(rel)) {
      result.missing.push(rel);
      continue;
    }
    if (actual.get(rel) !== mode) result.mode.push({ rel, expected: mode, actual: actual.get(rel) });
    const a = readFileSync(join(expectedRoot, rel));
    const b = readFileSync(join(actualRoot, rel));
    if (!a.equals(b)) result.content.push({ rel, lines: diffLines(a.toString('utf8'), b.toString('utf8')) });
  }
  for (const rel of actual.keys()) if (!expected.has(rel)) result.extra.push(rel);
  return result;
}

export function isClean(result) {
  return !result.missing.length && !result.extra.length && !result.mode.length && !result.content.length;
}

export function formatResult(result) {
  const lines = [];
  for (const rel of result.missing) lines.push(`missing  ${rel}`);
  for (const rel of result.extra) lines.push(`extra    ${rel}`);
  for (const m of result.mode) lines.push(`mode     ${m.rel} ${m.expected.toString(8)} -> ${m.actual.toString(8)}`);
  for (const c of result.content) {
    lines.push(`content  ${c.rel} (${c.lines.length} line(s))`);
    for (const l of c.lines.slice(0, 6)) {
      lines.push(`  ${l.line}- ${String(l.expected).slice(0, 160)}`);
      lines.push(`  ${l.line}+ ${String(l.actual).slice(0, 160)}`);
    }
  }
  return lines.join('\n');
}
