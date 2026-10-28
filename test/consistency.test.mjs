import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const registry = JSON.parse(read('src/hooks/registry.json'));
const rules = JSON.parse(read('src/permissions/rules.json'));

function timeoutsByModule(hooksJson, pick) {
  const out = {};
  for (const groups of Object.values(hooksJson.hooks)) {
    for (const handler of pick(groups)) out[handler.command.match(/hooks\/([a-z-]+)\.mjs/)[1]] = handler.timeout;
  }
  return out;
}

describe('one hook timeout per hook', () => {
  test('the registry declares no per-host timeout', () => {
    for (const [id, entry] of Object.entries(registry.entries)) assert.equal(entry.timeoutBy, undefined, id);
  });

  test('every emitted hooks file uses the registry timeout', () => {
    const flat = (groups) => groups.flatMap((g) => g.hooks ?? [g]);
    const trees = {
      'claude-code': timeoutsByModule(JSON.parse(read('dist/claude-code/plugins/lua-agent-builder/hooks/hooks.json')), flat),
      codex: timeoutsByModule(JSON.parse(read('dist/codex/hooks/hooks.json')), flat),
      cursor: timeoutsByModule(JSON.parse(read('dist/cursor/cursor-hooks.json')), flat),
    };
    for (const [host, timeouts] of Object.entries(trees)) {
      for (const [module, timeout] of Object.entries(timeouts)) {
        const entry = Object.values(registry.entries).find((e) => e.module === module);
        assert.equal(timeout, entry.timeout, `${host} ${module}`);
      }
    }
  });
});

describe('one permission rule set', () => {
  test('a row scoped to some hosts must say why', () => {
    for (const tier of Object.values(rules.tiers)) {
      for (const row of tier.filter((r) => typeof r !== 'string')) assert.ok(row.reason, `${row.rule} is host-scoped without a reason`);
    }
  });

  test('lua sync --accept sits in the same tier as its --pull twin on every host', () => {
    for (const path of ['dist/claude-code/plugins/lua-agent-builder/lib/permissions-template.json', 'dist/codex/lib/permissions-template.json']) {
      const { permissions } = JSON.parse(read(path));
      assert.ok(permissions.allow.includes('Bash(lua sync --pull*)') && permissions.allow.includes('Bash(lua sync --accept*)'), path);
      assert.ok(permissions.ask.includes('Bash(lua sync --pull --force*)') && permissions.ask.includes('Bash(lua sync --accept --force*)'), path);
    }
  });
});
