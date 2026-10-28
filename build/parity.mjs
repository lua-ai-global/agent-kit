#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT } from './emit.mjs';
import { listTree } from './compare.mjs';
import { permissionRules, skillNames } from './generators.mjs';
import { PRODUCTION_COMMANDS, UNCLASSIFIABLE_LABEL, UNRESOLVED_LABEL, classifyProductionCommand } from '../packages/core/lib/tokenizer.mjs';
import { normaliseInput } from '../packages/core/lib/host.mjs';

const TOKENIZER = readFileSync(join(ROOT, 'packages', 'core', 'lib', 'tokenizer.mjs'));
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'src', 'hooks', 'registry.json'), 'utf8'));
const RULES = JSON.parse(readFileSync(join(ROOT, 'src', 'permissions', 'rules.json'), 'utf8'));
const WAIVERS = JSON.parse(readFileSync(join(ROOT, 'src', 'permissions', 'waivers.json'), 'utf8'));
const TREES = {
  'claude-code': { root: 'claude-code/plugins/lua-agent-builder', template: true, foreign: ['${PLUGIN_ROOT}', '{{PLUGIN_ROOT}}', '${extensionPath}'] },
  codex: { root: 'codex', template: true, hookOnly: true, foreign: ['${CLAUDE_PLUGIN_ROOT}', '{{PLUGIN_ROOT}}', '${extensionPath}'] },
  cursor: { root: 'cursor', hookOnly: true, foreign: ['${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}', '${extensionPath}'] },
  universal: { root: 'universal', tierC: true, foreign: ['${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}', '{{PLUGIN_ROOT}}', '${extensionPath}'] },
};
const SHIPPED = /^(?!test\/|scripts\/|mcp\/lua-platform\/(tests|src|scripts|README)|CHANGELOG|README|SECURITY|docs\/|\.github\/).*\.(md|mdc|mjs|json|toml)$/;
const PROSE = /^(?!test\/|docs\/|CHANGELOG|README|SECURITY|mcp\/).*\.(md|mdc|toml)$/;
const HOOK_EVENTS = new Set(['PreToolUse', 'beforeShellExecution']);

const treeRoot = (dist, name) => join(dist, TREES[name].root);
const read = (path) => readFileSync(path, 'utf8');

function clause1(dist) {
  return Object.keys(TREES).filter((n) => !TREES[n].tierC)
    .filter((n) => !readFileSync(join(treeRoot(dist, n), 'lib', 'tokenizer.mjs')).equals(TOKENIZER))
    .map((n) => `clause 1: ${n} tokenizer differs from packages/core/lib/tokenizer.mjs`);
}

function sameRows(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clause2(dist) {
  const problems = [];
  for (const name of Object.keys(TREES).filter((n) => TREES[n].template)) {
    const { permissions } = JSON.parse(read(join(treeRoot(dist, name), 'lib', 'permissions-template.json')));
    const expected = permissionRules(ROOT, name);
    for (const tier of Object.keys(expected)) {
      if (!sameRows(permissions[tier], expected[tier])) problems.push(`clause 2: ${name} ${tier} tier does not match src/permissions/rules.json`);
    }
  }
  return problems;
}

function sampleFor(label) {
  return `${label} x`;
}

async function hookDecides(dist, name) {
  const plan = REGISTRY.hosts[name];
  const ids = Object.entries(plan).filter(([event]) => HOOK_EVENTS.has(event)).flatMap(([, list]) => list);
  const modules = [...new Set(ids.map((id) => REGISTRY.entries[id].module))];
  const out = [];
  for (const module of modules) {
    const path = join(treeRoot(dist, name), 'hooks', `${module}.mjs`);
    if (existsSync(path)) out.push((await import(pathToFileURL(path).href)).decide);
  }
  return out;
}

function blockedBy(decides, command) {
  const input = normaliseInput({ tool_name: 'Bash', tool_input: { command } });
  return decides.some((decide) => decide(input, {})?.block === true);
}

async function clause3(dist) {
  const problems = [];
  const notice = read(join(treeRoot(dist, 'universal'), 'skills', 'lua-agent-builder', 'SKILL.md'));
  for (const name of Object.keys(TREES)) {
    const decides = TREES[name].tierC ? [] : await hookDecides(dist, name);
    for (const { label } of PRODUCTION_COMMANDS) {
      const enforced = TREES[name].tierC ? notice.includes(`\`${label}\``) : blockedBy(decides, sampleFor(label));
      if (!enforced) problems.push(`clause 3: ${name} neither blocks nor waives \`${label}\``);
    }
  }
  return problems;
}

function commandsIn(text) {
  return [...text.matchAll(/`Bash\((.+?)\)`/g)].map((m) => m[1]).filter((c) => !c.includes('*'));
}

function commandProblem(command) {
  if (/--auto-deploy\b/.test(command)) return '--auto-deploy';
  const c = classifyProductionCommand(command);
  if (!c || c.prefixed || c.label === UNRESOLVED_LABEL || c.label === UNCLASSIFIABLE_LABEL) return null;
  return `bare \`${c.label}\``;
}

function fileCommandProblems(name, root, rel) {
  return commandsIn(read(join(root, rel)))
    .map((command) => ({ command, problem: commandProblem(command) }))
    .filter((c) => c.problem)
    .map((c) => `clause 4: ${name}/${rel} runs ${c.problem}: ${c.command.slice(0, 120)}`);
}

function clause4(dist) {
  const problems = [];
  for (const name of Object.keys(TREES)) {
    const root = treeRoot(dist, name);
    for (const rel of [...listTree(root).keys()].filter((r) => PROSE.test(r))) problems.push(...fileCommandProblems(name, root, rel));
  }
  return problems;
}

function clause5(dist) {
  const problems = [];
  for (const [name, tree] of Object.entries(TREES)) {
    const root = treeRoot(dist, name);
    for (const rel of [...listTree(root).keys()].filter((r) => SHIPPED.test(r))) {
      const text = read(join(root, rel));
      for (const token of tree.foreign.filter((t) => text.includes(t))) problems.push(`clause 5: ${name}/${rel} contains ${token}`);
    }
  }
  return problems;
}

function count(dist, rel, filter) {
  return readdirSync(join(dist, rel)).filter(filter).length;
}

function clause6(dist) {
  const skills = skillNames(ROOT).length;
  const expect = [
    ['claude-code commands', count(dist, 'claude-code/plugins/lua-agent-builder/commands', (f) => f.endsWith('.md')), skills],
    ['codex skills', count(dist, 'codex/skills', (f) => !f.startsWith('.')), skills],
    ['universal skills (all but lua-qa, plus the hub skill)', count(dist, 'universal/skills', (f) => !f.startsWith('.')), skills],
    ['codex rules', count(dist, 'codex/rules', (f) => f.endsWith('.mdc')), readdirSync(join(ROOT, 'src', 'knowledge')).length],
  ];
  return expect.filter(([, actual, wanted]) => actual !== wanted).map(([label, actual, wanted]) => `clause 6: ${label}: ${actual}, expected ${wanted}`);
}

function denySample(rule) {
  return rule.replace(/^Bash\(/, '').replace(/\)$/, '').replace(/\*$/, '').replace(/\*/g, 'x').replace(/\s+/g, ' ').trim();
}

async function clause7(dist) {
  const problems = [];
  const deny = RULES.tiers.deny.map((r) => (typeof r === 'string' ? r : r.rule));
  for (const name of Object.keys(TREES)) {
    const tree = TREES[name];
    if (tree.template && !existsSync(join(treeRoot(dist, name), 'test', 'lib', 'permissions-mirror.test.mjs'))) {
      problems.push(`clause 7: ${name} ships a permission template without test/lib/permissions-mirror.test.mjs`);
    }
    if (!tree.hookOnly) continue;
    const decides = await hookDecides(dist, name);
    for (const rule of deny.filter((r) => !(r in WAIVERS.hookOnlyHosts))) {
      if (!blockedBy(decides, denySample(rule))) problems.push(`clause 7: ${name} hooks do not enforce deny rule ${rule} (sample: ${denySample(rule)})`);
    }
  }
  return problems;
}

export async function runParity(dist = join(ROOT, 'dist')) {
  const problems = [
    ...clause1(dist), ...clause2(dist), ...(await clause3(dist)), ...clause4(dist), ...clause5(dist), ...clause6(dist), ...(await clause7(dist)),
  ];
  const digest = createHash('sha256').update(readFileSync(join(ROOT, 'src', 'permissions', 'rules.json'))).digest('hex').slice(0, 16);
  return { problems, clauses: [1, 2, 3, 4, 5, 6, 7], rulesDigest: digest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, rulesDigest } = await runParity();
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\nparity FAILED\n`);
    process.exit(1);
  }
  process.stdout.write(`parity: clauses 1-7 hold for claude-code, codex, cursor and universal (rules.json ${rulesDigest})\n`);
}
