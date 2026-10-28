import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_COMMANDS } from '../../packages/core/lib/tokenizer.mjs';
import { applyPairs, applyRules, loadGlossary } from '../../build/glossary.mjs';
import { kitReader } from '../../build/readers.mjs';
import { splitFrontmatter } from '../../build/transforms.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = 'skills/lua-agent-builder';
const EXCLUDED_SKILLS = new Set(['lua-qa']);
const SPEC_KEYS = new Set(['name', 'description']);

export const name = 'universal';
export const profile = JSON.parse(readFileSync(join(HERE, 'profile.json'), 'utf8'));
export const mounts = [];
export const stamps = [];
export const banner = [];
export const mirrors = [{ from: 'skills', to: 'skills' }];

export function tierCNotice() {
  const verbs = [...new Set(PRODUCTION_COMMANDS.map((c) => `\`${c.label}\``))].join(', ');
  return [
    '> **Tier C: the deploy gate is not enforced on this agent.** This agent runs no hook that can stop a command,',
    '> so these skills never run a command that changes production. The production verbs are ' + `${verbs}, under any of the names \`lua\`, \`heylua\` and \`lua-ai\`.`,
    '> When a step below reaches one, print the exact command with its `LUA_DEPLOY_CONFIRMED=1` prefix for the user',
    '> to run in their own terminal, and stop. Never pass `--auto-deploy`. Never run `lua auth key`, `lua auth configure`',
    '> or `lua auth logout`: the first prints the API key into this conversation, the second collects an email and a',
    '> one-time code, the third discards the credential. A command that changes organisation settings (`lua env`,',
    '> `lua drains`, `lua devices`, `lua decisions publish|delete`, `lua browser run`, `lua integrations`, the',
    '> `lua workflows` run controls) needs the user\'s explicit yes in this conversation before you run it.',
  ].join('\n');
}

function specFrontmatter(fields) {
  return `---\nname: ${fields.name}\ndescription: ${JSON.stringify(fields.description)}\nmetadata:\n  lua-agent-builder-tier: "C"\n---\n`;
}

function universalSkill(glossary, path, text) {
  const { fields, body } = splitFrontmatter(applyRules(glossary, 'skill', text));
  const dropped = Object.keys(fields).filter((k) => !SPEC_KEYS.has(k));
  const out = `${specFrontmatter(fields)}\n${tierCNotice()}\n${body}`;
  return { content: applyPairs(glossary, path, out), dropped, fields };
}

function hubSkill(skills, references) {
  const skillIndex = skills.map((s) => `- \`${s.name}\`: ${s.description}`).join('\n');
  const referenceIndex = references.map((r) => `- \`references/${r}.md\``).join('\n');
  return readFileSync(join(HERE, 'templates', 'lua-agent-builder', 'SKILL.md'), 'utf8')
    .replace('{{TIER_C_NOTICE}}', tierCNotice())
    .replace('{{SKILL_INDEX}}', skillIndex)
    .replace('{{REFERENCE_INDEX}}', referenceIndex);
}

export function generate({ root }) {
  const reader = kitReader(root);
  const glossary = loadGlossary(root, 'universal');
  const out = [];
  const index = [];
  for (const skill of reader.skills().filter((s) => !EXCLUDED_SKILLS.has(s))) {
    const path = `skills/${skill}/SKILL.md`;
    const { content, fields } = universalSkill(glossary, path, reader.skill(skill));
    out.push({ path, content });
    index.push({ name: fields.name, description: fields.description });
  }
  const references = reader.knowledge();
  for (const ref of references) {
    out.push({ path: `${HUB}/references/${ref}.md`, content: applyRules(glossary, 'rule', reader.knowledgeText(ref)) });
  }
  for (const agent of reader.agents()) {
    const { body } = splitFrontmatter(reader.agent(agent));
    out.push({ path: `${HUB}/references/agents/${agent}.md`, content: applyRules(glossary, 'agent', body.replace(/^\n/, '')) });
  }
  out.push({ path: `${HUB}/SKILL.md`, content: hubSkill(index, references) });
  return out;
}
