#!/usr/bin/env node
// Validates the metadata block on every user-shipped prompt asset:
//   - skills/<name>/SKILL.md  — YAML frontmatter
//   - rules/<name>.mdc        — YAML frontmatter
//   - agents/<name>.toml      — top-level TOML keys
//
// Unknown keys are the failure this catches. A host that does not recognise
// a key silently ignores it, so a typo'd field reads as a working setting
// while doing nothing at all. The Claude Code port shipped
// `permission-mode: stepwise` on a slash command for several iterations that
// way: the field does not exist, the value never applied, and the only
// reason anything depended on it was that a lint grepped for the string.
//
// An `x-` prefix marks a deliberate local extension and is always accepted,
// so a lint-only signal can never collide with a future host field.

import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

const SKILL_FIELDS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments',
  'model', 'allowed-tools', 'agent', 'hooks', 'paths', 'shell',
]);

const RULE_FIELDS = new Set(['description', 'globs', 'alwaysApply']);

const AGENT_FIELDS = new Set([
  'name', 'description', 'developer_instructions', 'model', 'tools',
  'mcp_servers', 'skills',
]);

const MODEL_KEYWORDS = new Set(['sonnet', 'opus', 'haiku', 'inherit', 'gpt-5', 'gpt-5-codex', 'o3']);

function parseYamlFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (km) fields[km[1]] = km[2].trim();
  }
  return fields;
}

// Top-level TOML keys only: `key = value` or `key = """`. A key indented or
// inside a multi-line string is part of a value, not a field, so the scan
// tracks whether it is inside a `"""` block.
function parseTomlKeys(content) {
  const fields = {};
  let inBlockString = false;
  for (const line of content.split('\n')) {
    const fences = (line.match(/"""/g) ?? []).length;
    if (inBlockString) {
      if (fences % 2 === 1) inBlockString = false;
      continue;
    }
    const km = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.*)$/);
    if (km) fields[km[1]] = km[2].trim();
    if (fences % 2 === 1) inBlockString = true;
  }
  return fields;
}

function checkFields(path, fields, schema, label) {
  for (const key of Object.keys(fields)) {
    if (key.startsWith('x-')) continue;
    if (!schema.has(key)) {
      fail(`${path}: ${label} declares unrecognised field "${key}". The host silently ignores keys it does not know, so the value has no effect. Rename it to a documented field or prefix it with \`x-\` to mark it as a local extension.`);
    }
  }
  const model = fields.model?.replace(/^["']|["']$/g, '');
  if (model && !MODEL_KEYWORDS.has(model)) {
    fail(`${path}: model "${model}" is not one of ${[...MODEL_KEYWORDS].join(', ')}. Leave it out to inherit the session's model.`);
  }
  for (const required of ['name', 'description']) {
    if (schema.has(required) && !fields[required]) {
      fail(`${path}: ${label} is missing a "${required}".`);
    }
  }
}

let skills = 0;
try {
  for (const entry of await readdir('skills', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join('skills', entry.name, 'SKILL.md');
    let content;
    try { content = await readFile(path, 'utf8'); } catch {
      fail(`skills/${entry.name}/ has no SKILL.md — the host loads a skill by that filename, so this directory ships nothing.`);
      continue;
    }
    const fields = parseYamlFrontmatter(content);
    if (!fields) {
      fail(`${path}: missing frontmatter (a --- block at the top of the file).`);
      continue;
    }
    if (fields.name !== entry.name) {
      fail(`${path}: frontmatter name "${fields.name}" does not match its directory "${entry.name}". The host invokes a skill by directory; a mismatched name makes the two disagree.`);
    }
    checkFields(path, fields, SKILL_FIELDS, 'skill');
    skills++;
  }
} catch { /* no skills/ — reported by the zero-match guard below */ }

let rules = 0;
try {
  for (const file of (await readdir('rules')).filter((f) => extname(f) === '.mdc')) {
    const path = join('rules', file);
    const content = await readFile(path, 'utf8');
    const fields = parseYamlFrontmatter(content);
    if (!fields) {
      fail(`${path}: missing frontmatter (a --- block at the top of the file).`);
      continue;
    }
    for (const key of Object.keys(fields)) {
      if (!key.startsWith('x-') && !RULE_FIELDS.has(key)) {
        fail(`${path}: rule declares unrecognised field "${key}". Valid: ${[...RULE_FIELDS].join(', ')}.`);
      }
    }
    if (!fields.description) {
      fail(`${path}: rule has no description. The description is what the model reads when deciding whether to attach the rule, so without one the rule is never chosen.`);
    }
    if (!('alwaysApply' in fields)) {
      fail(`${path}: rule has no alwaysApply field. Set it to false for a rule that is attached on demand.`);
    }
    rules++;
  }
} catch { /* no rules/ */ }

let agents = 0;
try {
  for (const file of (await readdir('agents')).filter((f) => extname(f) === '.toml')) {
    const path = join('agents', file);
    const content = await readFile(path, 'utf8');
    const fields = parseTomlKeys(content);
    checkFields(path, fields, AGENT_FIELDS, 'agent');
    if (!fields.developer_instructions) {
      fail(`${path}: agent has no developer_instructions — that block is the agent's prompt, so without it the agent has no behaviour.`);
    }
    const expected = file.replace(/\.toml$/, '');
    const declared = fields.name?.replace(/^["']|["']$/g, '');
    if (declared && declared !== expected) {
      fail(`${path}: name "${declared}" does not match the filename "${expected}".`);
    }
    agents++;
  }
} catch { /* no agents/ */ }

// A silent zero-match is how a renamed directory or a broken extension
// filter turns this lint into a no-op that still prints a tick.
if (skills === 0 && rules === 0 && agents === 0 && !failed) {
  fail('Found 0 skills, 0 rules and 0 agents to check. Either those directories moved or the filename filters are broken. Refusing to pass silently.');
}

if (failed) {
  console.error('\nFix the issues above and re-run `npm run lint`.');
  process.exit(1);
}
console.log(`✓ Frontmatter: ${skills} skill(s) + ${rules} rule(s) + ${agents} agent(s) declare only recognised fields.`);
