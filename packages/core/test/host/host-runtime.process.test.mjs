import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_BY_HOST = {
  'claude-code': { CLAUDE_PLUGIN_ROOT: '/plugin' },
  codex: { PLUGIN_ROOT: '/plugin' },
  cursor: { CURSOR_TRACE_ID: 'trace' },
};

let plugin;

beforeAll(() => {
  plugin = realpathSync(mkdtempSync(join(tmpdir(), 'lua-kit-host-')));
  cpSync(join(CORE, 'hooks'), join(plugin, 'hooks'), { recursive: true });
  cpSync(join(CORE, 'lib'), join(plugin, 'lib'), { recursive: true });
  copyFileSync(join(CORE, 'lib', 'host-runtime.mjs'), join(plugin, 'lib', 'hook-runtime.mjs'));
  writeFileSync(join(plugin, 'lib', 'host-default.mjs'), "export const DEFAULT_HOST = 'codex';\nexport const FAIL_CLOSED_HOOKS = ['confirm-deploy'];\n");
});

afterAll(() => {
  rmSync(plugin, { recursive: true, force: true });
});

function wire(host, command) {
  if (host === 'cursor') return { command, cwd: plugin };
  return { tool_name: 'Bash', tool_input: { command }, cwd: plugin };
}

function run(host, hook, command) {
  const env = { PATH: process.env.PATH, HOME: plugin, ...ENV_BY_HOST[host] };
  const r = spawnSync(process.execPath, [join(plugin, 'hooks', `${hook}.mjs`)], {
    input: JSON.stringify(wire(host, command)), env, encoding: 'utf8', timeout: 20_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe.each(Object.keys(ENV_BY_HOST))('shipped hook processes under %s', (host) => {
  test('confirm-deploy blocks a bare production verb', () => {
    const r = run(host, 'confirm-deploy', 'cd x && lua deploy all');
    if (host === 'cursor') {
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ permission: 'deny' });
    } else {
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/LUA_DEPLOY_CONFIRMED=1/);
    }
  });

  test('confirm-deploy lets the confirmed form through untouched', () => {
    const r = run(host, 'confirm-deploy', 'LUA_DEPLOY_CONFIRMED=1 lua deploy all');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  test('block-auth-configure blocks the credential prompt', () => {
    const r = run(host, 'block-auth-configure', 'lua auth configure');
    if (host === 'cursor') expect(JSON.parse(r.stdout).permission).toBe('deny');
    else expect(r.code).toBe(2);
  });

  test('approve-web-app pre-approves the one exact command in the host format', () => {
    const r = run(host, 'approve-web-app', 'lua apps new board');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    if (host === 'cursor') expect(out.permission).toBe('allow');
    else expect(out.hookSpecificOutput.permissionDecision).toBe('allow');
    if (host === 'codex') expect(out.hookSpecificOutput.updatedInput.command).toBe('lua apps new board');
  });

  test('a hook reached through a symlinked plugin path still runs', () => {
    const linked = join(dirname(plugin), `${plugin.split('/').pop()}-link`);
    rmSync(linked, { force: true });
    symlinkSync(plugin, linked);
    const env = { PATH: process.env.PATH, HOME: plugin, ...ENV_BY_HOST[host] };
    const r = spawnSync(process.execPath, [join(linked, 'hooks', 'confirm-deploy.mjs')], {
      input: JSON.stringify(wire(host, 'lua deploy all')), env, encoding: 'utf8', timeout: 20_000,
    });
    rmSync(linked, { force: true });
    if (host === 'cursor') expect(JSON.parse(r.stdout).permission).toBe('deny');
    else expect(r.status).toBe(2);
  });

  function crash(hook) {
    const env = { PATH: process.env.PATH, HOME: plugin, ...ENV_BY_HOST[host] };
    return spawnSync(process.execPath, [join(plugin, 'hooks', `${hook}.mjs`)], {
      input: '{not json', env, encoding: 'utf8', timeout: 20_000,
    });
  }

  test('a hook that crashes fails open', () => {
    const r = crash('block-auth-configure');
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/fail-open/);
  });

  test('a hook listed as fail-closed blocks when it crashes', () => {
    const r = crash('confirm-deploy');
    if (host === 'cursor') {
      expect(JSON.parse(r.stdout)).toMatchObject({ permission: 'deny' });
    } else {
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/fail-closed/);
    }
  });
});
