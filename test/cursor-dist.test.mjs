import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURSOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cursor');
const hooksJson = JSON.parse(readFileSync(join(CURSOR, 'cursor-hooks.json'), 'utf8'));

function runHook(hook, stdin, env = {}) {
  const r = spawnSync(process.execPath, [join(CURSOR, 'hooks', `${hook}.mjs`)], {
    input: stdin, encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH, HOME: CURSOR, CURSOR_TRACE_ID: 't', ...env },
  });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
}

const shell = (command) => JSON.stringify({ command, cwd: CURSOR, hook_event_name: 'beforeShellExecution' });

describe('Cursor hooks.json', () => {
  test('is version 1 and registers the gate on beforeShellExecution with failClosed', () => {
    assert.equal(hooksJson.version, 1);
    const gate = hooksJson.hooks.beforeShellExecution.find((h) => h.command.includes('confirm-deploy'));
    assert.equal(gate.failClosed, true);
    const shellGate = hooksJson.hooks.beforeShellExecution.find((h) => h.command.includes('before-shell-execution'));
    assert.equal(shellGate.failClosed, true);
  });
});

describe('Cursor gate in the emitted tree', () => {
  test('a bare lua deploy all is denied with the Cursor protocol', () => {
    const r = runHook('confirm-deploy', shell('lua deploy all'));
    assert.equal(r.code, 0);
    assert.equal(r.out.permission, 'deny');
    assert.match(r.out.agent_message, /LUA_DEPLOY_CONFIRMED=1/);
  });

  test('the confirmed form passes untouched', () => {
    const r = runHook('confirm-deploy', shell('LUA_DEPLOY_CONFIRMED=1 lua deploy all'));
    assert.equal(r.code, 0);
    assert.equal(r.out, null);
  });

  test('credential printers are denied under every binary name', () => {
    for (const bin of ['lua', 'heylua', 'lua-ai', 'npx lua-cli']) {
      for (const verb of ['auth key', 'auth configure', 'auth logout']) {
        const r = runHook('before-shell-execution', shell(`${bin} ${verb}`));
        assert.equal(r.out.permission, 'deny', `${bin} ${verb}`);
      }
    }
  });

  test('the gate fails closed when it cannot read its input', () => {
    const r = runHook('confirm-deploy', '{not json');
    assert.equal(r.out.permission, 'deny');
    assert.match(r.out.user_message, /fail-closed/);
  });

  test('a non-gate hook still fails open', () => {
    const r = runHook('warn-version-zero', '{not json');
    assert.equal(r.code, 0);
    assert.equal(r.out, null);
    assert.match(r.err, /fail-open/);
  });
});
