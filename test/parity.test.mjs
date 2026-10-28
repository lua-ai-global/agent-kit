import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runParity } from '../build/parity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let work;

function copyDist(name) {
  const dist = join(work, name);
  cpSync(join(ROOT, 'dist'), dist, { recursive: true });
  return dist;
}

function edit(path, from, to) {
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes(from), `${path} does not contain ${from}`);
  writeFileSync(path, text.replace(from, to));
}

before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'lua-kit-parity-')));
});

after(() => rmSync(work, { recursive: true, force: true }));

describe('parity over the committed dist', () => {
  test('all seven clauses hold', async () => {
    const { problems, clauses } = await runParity(join(ROOT, 'dist'));
    assert.deepEqual(problems, []);
    assert.deepEqual(clauses, [1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('parity catches drift', () => {
  test('clause 2: a permission row dropped from one host', async () => {
    const dist = copyDist('c2');
    edit(join(dist, 'codex', 'lib', 'permissions-template.json'), '"Bash(lua sync --check*)",', '');
    const { problems } = await runParity(dist);
    assert.ok(problems.some((p) => p.startsWith('clause 2: codex')), problems.join('\n'));
  });

  test('clause 3: a host whose gate no longer blocks a production verb', async () => {
    const dist = copyDist('c3');
    edit(join(dist, 'cursor', 'hooks', 'confirm-deploy.mjs'), 'export function decide(input, env = process.env) {', 'export function decide(input, env = process.env) {\n  if (input) return null;');
    const { problems } = await runParity(dist);
    assert.ok(problems.some((p) => p.startsWith('clause 3: cursor') && p.includes('lua version promote')), problems.join('\n'));
  });

  test('clause 4: a skill that tells the model to run a bare production verb or --auto-deploy', async () => {
    const dist = copyDist('c4');
    const skill = join(dist, 'codex', 'skills', 'lua-push', 'SKILL.md');
    writeFileSync(skill, `${readFileSync(skill, 'utf8')}\nRun \`Bash(lua deploy all)\` then \`Bash(lua push skill --ci --auto-deploy)\`.\n`);
    const { problems } = await runParity(dist);
    assert.ok(problems.some((p) => p.startsWith('clause 4: codex/skills/lua-push') && p.includes('lua deploy all')), problems.join('\n'));
    assert.ok(problems.some((p) => p.includes('--auto-deploy')), problems.join('\n'));
  });

  test('clause 7: a hook-only host that stops denying a credential row', async () => {
    const dist = copyDist('c7');
    edit(join(dist, 'codex', 'hooks', 'before-shell-execution.mjs'), 'if (AUTH_KEY.test(command)) {', 'if (false && AUTH_KEY.test(command)) {');
    const { problems } = await runParity(dist);
    assert.ok(problems.some((p) => p.startsWith('clause 7: codex') && p.includes('auth key')), problems.join('\n'));
  });
});
