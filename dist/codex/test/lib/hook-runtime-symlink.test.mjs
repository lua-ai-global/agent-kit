import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOSTS = {
  'claude-code': { env: { CLAUDE_PLUGIN_ROOT: '/plugin' }, wire: (command) => ({ tool_name: 'Bash', tool_input: { command } }) },
  codex: { env: { PLUGIN_ROOT: '/plugin' }, wire: (command) => ({ tool_name: 'Bash', tool_input: { command } }) },
  cursor: { env: { CURSOR_TRACE_ID: 'trace' }, wire: (command) => ({ command, cwd: '/' }) },
};

let base;
let linked;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lua-hook-symlink-')));
  cpSync(join(PLUGIN, 'hooks'), join(base, 'real', 'hooks'), { recursive: true });
  cpSync(join(PLUGIN, 'lib'), join(base, 'real', 'lib'), { recursive: true });
  linked = join(base, 'linked');
  symlinkSync(join(base, 'real'), linked);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function run(host, root, command) {
  const { env, wire } = HOSTS[host];
  return spawnSync(process.execPath, [join(root, 'hooks', 'confirm-deploy.mjs')], {
    input: JSON.stringify(wire(command)), encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH, HOME: base, ...env },
  });
}

function blocked(host, r) {
  if (host === 'cursor' && r.stdout.includes('"permission"')) return JSON.parse(r.stdout).permission === 'deny';
  return r.status === 2;
}

describe.each(Object.keys(HOSTS))('the deploy gate behind a symlinked plugin path (%s payload)', (host) => {
  test('fires through the real path', () => {
    expect(blocked(host, run(host, join(base, 'real'), 'lua deploy all'))).toBe(true);
  });

  test('fires through the symlinked path', () => {
    expect(blocked(host, run(host, linked, 'lua deploy all'))).toBe(true);
  });

  test('still lets the confirmed form through the symlinked path', () => {
    const r = run(host, linked, 'LUA_DEPLOY_CONFIRMED=1 lua deploy all');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});
