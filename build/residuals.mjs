import { readFileSync } from 'node:fs';

export function loadResiduals(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return { categories: data.categories ?? {}, residuals: data.residuals ?? {} };
}

export function observedDifferences(result, isVersionOnly, allowed = new Set()) {
  const found = new Map();
  for (const rel of result.missing) found.set(rel, 'missing');
  for (const rel of result.extra) found.set(rel, 'extra');
  for (const m of result.mode) found.set(m.rel, 'mode');
  for (const c of result.content) found.set(c.rel, isVersionOnly(c.rel) ? 'version' : 'content');
  for (const rel of allowed) found.delete(rel);
  return found;
}

function declarationProblems(declared) {
  const problems = [];
  for (const [rel, d] of Object.entries(declared.residuals)) {
    if (!(d.category in declared.categories)) problems.push(`${rel}: unknown category ${d.category}`);
    if (!d.reason) problems.push(`${rel}: no reason given`);
  }
  return problems;
}

export function auditResiduals(found, declared) {
  const problems = declarationProblems(declared);
  for (const [rel, kind] of found) {
    if (kind === 'version') continue;
    const d = declared.residuals[rel];
    if (!d) problems.push(`undeclared ${kind}: ${rel}`);
    else if (d.kind !== kind) problems.push(`${rel}: declared ${d.kind}, observed ${kind}`);
  }
  for (const rel of Object.keys(declared.residuals)) if (!found.has(rel)) problems.push(`stale declaration (no longer differs): ${rel}`);
  return problems;
}

export function formatByCategory(found, declared) {
  const byCategory = {};
  for (const [rel, kind] of found) {
    const category = kind === 'version' ? 'version-stamp' : declared.residuals[rel]?.category ?? 'UNDECLARED';
    (byCategory[category] ??= []).push(`${kind.padEnd(8)} ${rel}`);
  }
  return Object.entries(byCategory).sort().map(([c, rows]) => `${c} (${rows.length})\n${rows.map((r) => `  ${r}`).join('\n')}`).join('\n');
}
