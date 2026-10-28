#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './emit.mjs';
import { listTree } from './compare.mjs';
import { skillNames } from './generators.mjs';

const DIST = join(ROOT, 'dist');
const TOKENIZER = readFileSync(join(ROOT, 'packages', 'core', 'lib', 'tokenizer.mjs'));
const TREES = {
  'claude-code': { root: 'claude-code/plugins/lua-agent-builder', foreign: ['${PLUGIN_ROOT}', '{{PLUGIN_ROOT}}', '${extensionPath}'] },
  codex: { root: 'codex', foreign: ['${CLAUDE_PLUGIN_ROOT}', '{{PLUGIN_ROOT}}', '${extensionPath}'] },
  cursor: { root: 'cursor', foreign: ['${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}', '${extensionPath}'] },
  universal: { root: 'universal', foreign: ['${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}', '{{PLUGIN_ROOT}}', '${extensionPath}'] },
};
const SHIPPED = /^(?!test\/|scripts\/|mcp\/lua-platform\/(tests|src|scripts|README)|CHANGELOG|README|SECURITY|docs\/|\.github\/).*\.(md|mdc|mjs|json|toml)$/;
const problems = [];

function clauseTokenizer() {
  for (const [name, tree] of Object.entries(TREES)) {
    if (name === 'universal') continue;
    const copy = readFileSync(join(DIST, tree.root, 'lib', 'tokenizer.mjs'));
    if (!copy.equals(TOKENIZER)) problems.push(`clause 1: ${name} tokenizer differs from packages/core/lib/tokenizer.mjs`);
  }
}

function foreignTokens(name, tree, rel) {
  const text = readFileSync(join(DIST, tree.root, rel), 'utf8');
  return tree.foreign.filter((token) => text.includes(token)).map((token) => `clause 5: ${name}/${rel} contains ${token}`);
}

function clauseForeignTokens() {
  for (const [name, tree] of Object.entries(TREES)) {
    const shipped = [...listTree(join(DIST, tree.root)).keys()].filter((rel) => SHIPPED.test(rel));
    for (const rel of shipped) problems.push(...foreignTokens(name, tree, rel));
  }
}

function count(dir, filter) {
  return readdirSync(join(DIST, dir)).filter(filter).length;
}

function clauseCounts() {
  const skills = skillNames(ROOT).length;
  const expect = [
    ['claude-code commands', count('claude-code/plugins/lua-agent-builder/commands', (f) => f.endsWith('.md')), skills],
    ['codex skills', count('codex/skills', (f) => !f.startsWith('.')), skills],
    ['universal skills (all but lua-qa, plus the hub skill)', count('universal/skills', (f) => !f.startsWith('.')), skills],
    ['codex rules', count('codex/rules', (f) => f.endsWith('.mdc')), readdirSync(join(ROOT, 'src', 'knowledge')).length],
  ];
  for (const [label, actual, wanted] of expect) {
    if (actual !== wanted) problems.push(`clause 6: ${label}: ${actual}, expected ${wanted}`);
  }
}

clauseTokenizer();
clauseForeignTokens();
clauseCounts();
if (problems.length) {
  process.stderr.write(`${problems.join('\n')}\nparity FAILED\n`);
  process.exit(1);
}
process.stdout.write('parity: clause 1 (one tokenizer), clause 5 (no foreign host token in shipped files), clause 6 (no dropped skill or rule) hold for claude-code, codex, cursor and universal\n');
