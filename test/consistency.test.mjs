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

  test('lua sync --accept has no row on any host, so it falls to the host prompt, and --pull keeps its tiers', () => {
    const templates = ['dist/claude-code/plugins/lua-agent-builder/lib/permissions-template.json', 'dist/codex/lib/permissions-template.json'];
    const rowSets = templates.map((path) => JSON.parse(read(path)).permissions);
    for (const [i, permissions] of rowSets.entries()) {
      const all = Object.values(permissions).flat();
      assert.equal(all.some((r) => r.includes('--accept')), false, templates[i]);
      assert.ok(permissions.allow.includes('Bash(lua sync --pull*)') && permissions.ask.includes('Bash(lua sync --pull --force*)'), templates[i]);
    }
    const shared = (p) => Object.fromEntries(Object.entries(p).map(([tier, rows]) => [tier, rows.filter((r) => !r.includes('lib/qa/cli.mjs'))]));
    assert.deepEqual(shared(rowSets[0]), shared(rowSets[1]));
  });
});
