import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'dist', 'universal', 'skills');
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLAUDE_ONLY = ['${CLAUDE_PLUGIN_ROOT}', 'AskUserQuestion', 'subagent_type', 'Skill tool', 'Claude Code'];

function frontmatter(text) {
  const m = /^---\nname: (.+)\ndescription: (.+)\nmetadata:\n {2}lua-agent-builder-tier: "C"\n---\n/.exec(text);
  return m ? { name: m[1], description: JSON.parse(m[2].startsWith('"') ? m[2] : JSON.stringify(m[2])) } : null;
}

describe('universal Tier C skills', () => {
  const names = readdirSync(SKILLS).sort();

  test('the QA harness stays Claude-only', () => {
    assert.equal(names.includes('lua-qa'), false);
  });

  for (const name of names) {
    const text = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');

    test(`${name}: spec frontmatter, name matches the folder`, () => {
      const fm = frontmatter(text);
      assert.ok(fm, 'frontmatter is name, description and the tier metadata only');
      assert.equal(fm.name, name);
      assert.match(fm.name, NAME_RE);
      assert.ok(fm.name.length <= 64);
      assert.ok(fm.description.length > 0 && fm.description.length <= 1024, `description is ${fm.description.length} chars`);
    });

    test(`${name}: carries the Tier C notice and no Claude-only vocabulary`, () => {
      assert.match(text, /Tier C: the deploy gate is not enforced on this agent/);
      assert.match(text, /print the exact command with its `LUA_DEPLOY_CONFIRMED=1` prefix/);
      for (const token of CLAUDE_ONLY) assert.equal(text.includes(token), false, `${name} contains ${token}`);
    });

    test(`${name}: every relative reference resolves inside the skills folder`, () => {
      for (const [, rel] of text.matchAll(/`(\.\.\/lua-agent-builder\/[^`\s]+\.md)`/g)) {
        assert.ok(existsSync(resolve(join(SKILLS, name), rel)), `${name} -> ${rel}`);
      }
    });
  }
});
