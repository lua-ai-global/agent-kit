import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadGlossary(root, host) {
  const glossary = JSON.parse(readFileSync(join(root, 'src', 'glossary', `${host}.json`), 'utf8'));
  return { rules: glossary.rules ?? [], files: glossary.files ?? {}, used: new Set() };
}

function countOccurrences(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) count += 1;
  return count;
}

export function applyRules(glossary, kind, text) {
  let out = text;
  for (const rule of glossary.rules) {
    if (rule.kinds && !rule.kinds.includes(kind)) continue;
    out = out.replace(new RegExp(rule.pattern, 'g'), rule.replace);
  }
  return out;
}

export function applyPairs(glossary, path, text) {
  let out = text;
  for (const [index, pair] of (glossary.files[path] ?? []).entries()) {
    const count = countOccurrences(out, pair.from);
    if (count !== 1) throw new Error(`glossary ${path}#${index}: expected exactly 1 match, found ${count}`);
    out = out.replace(pair.from, () => pair.to);
  }
  glossary.used.add(path);
  return out;
}

export function applyGlossary(glossary, { kind, path }, text) {
  return applyPairs(glossary, path, applyRules(glossary, kind, text));
}

export function unusedGlossaryPaths(glossary) {
  return Object.keys(glossary.files).filter((path) => !glossary.used.has(path));
}
