import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CURSOR = join(ROOT, 'dist', 'cursor');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const hooksJson = readJson(join(CURSOR, 'hooks', 'hooks.json'));

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

describe('Cursor plugin layout', () => {
  test('the repo catalog points at dist/cursor and names the plugin it finds there', () => {
    const catalog = readJson(join(ROOT, '.cursor-plugin', 'marketplace.json'));
    assert.match(catalog.name, /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
    assert.equal(typeof catalog.owner.name, 'string');
    const [entry] = catalog.plugins;
    assert.equal(join(ROOT, entry.source), CURSOR);
    assert.equal(readJson(join(CURSOR, '.cursor-plugin', 'plugin.json')).name, entry.name);
  });

  test('the manifest carries the kit version', () => {
    const { version } = readJson(join(ROOT, 'package.json'));
    assert.equal(readJson(join(CURSOR, '.cursor-plugin', 'plugin.json')).version, version);
  });

  test('every hook command runs a hook file shipped in the plugin, relative to the plugin root', () => {
    for (const handler of hooksJson.hooks.beforeShellExecution) {
      const [, file] = handler.command.match(/^node \.\/(hooks\/[a-z-]+\.mjs)$/);
      assert.ok(existsSync(join(CURSOR, file)), file);
    }
  });

  test('the MCP server path uses the root Cursor expands and points at the shipped bundle', () => {
    const { mcpServers } = readJson(join(CURSOR, 'mcp.json'));
    const [arg] = mcpServers['lua-platform'].args;
    assert.ok(arg.startsWith('${CURSOR_PLUGIN_ROOT}/'));
    assert.ok(existsSync(join(CURSOR, arg.slice('${CURSOR_PLUGIN_ROOT}/'.length))));
    assert.equal(mcpServers['lua-platform'].env, undefined);
  });
});

describe('Cursor gate in the emitted tree', () => {
  test('a bare lua deploy all is denied with the Cursor protocol', () => {
    const r = runHook('confirm-deploy', shell('lua deploy all'));
    assert.equal(r.code, 0);
    assert.equal(r.out.permission, 'deny');
    assert.match(r.out.agent_message, /LUA_DEPLOY_CONFIRMED=1/);
  });

  test('the confirmed form passes with an empty response, never an approval', () => {
    const r = runHook('confirm-deploy', shell('LUA_DEPLOY_CONFIRMED=1 lua deploy all'));
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, {});
  });

  test('every hook answers an unrelated command with an empty response, so a fail-closed hook never blocks it', () => {
    for (const handler of hooksJson.hooks.beforeShellExecution) {
      const hook = handler.command.match(/hooks\/([a-z-]+)\.mjs$/)[1];
      const r = runHook(hook, shell('ls -la'));
      assert.equal(r.code, 0, hook);
      assert.deepEqual(r.out, {}, hook);
    }
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
