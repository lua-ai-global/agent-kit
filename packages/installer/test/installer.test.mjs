import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(PKG, 'bin', 'agent-kit.mjs');
const PAYLOAD = join(PKG, 'payload');
const VERSION = JSON.parse(readFileSync(join(PAYLOAD, 'manifest.json'), 'utf8')).version;

let root;
let fakeBin;
let nextPayload;

function makeFakeBin(dir, names) {
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    copyFileSync(join(PKG, 'test', 'fixtures', 'fake-host.mjs'), join(dir, name));
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function sandbox(name) {
  const dir = join(root, name);
  const home = join(dir, 'home');
  const project = join(dir, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: project });
  return { home, project, kit: join(home, '.lua', 'agent-kit') };
}

function cli(box, args, extra = {}) {
  const env = {
    HOME: box.home,
    PATH: [fakeBin, dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    ...extra,
  };
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: box.project, env, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function state(box) {
  return JSON.parse(readFileSync(join(box.kit, 'installed.json'), 'utf8'));
}

function listAll(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-kit-test-')));
  fakeBin = makeFakeBin(join(root, 'bin'), ['claude', 'codex']);
  nextPayload = join(root, 'payload-next');
  cpSync(PAYLOAD, nextPayload, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(nextPayload, 'manifest.json'), 'utf8'));
  writeFileSync(join(nextPayload, 'manifest.json'), JSON.stringify({ ...manifest, version: '99.0.0' }));
  writeFileSync(join(nextPayload, 'skills', 'lua-deploy', 'NEXT.md'), 'next\n');
});

after(() => rmSync(root, { recursive: true, force: true }));

describe('install', () => {
  test('dry run writes nothing', () => {
    const box = sandbox('dry');
    const r = cli(box, ['install', '--agent', 'claude-code,codex', '--dry-run']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Dry run: nothing was written/);
    assert.deepEqual(readdirSync(box.home), []);
  });

  test('zero detected agents prints the supported set and exits 0', () => {
    const box = sandbox('none');
    const r = cli(box, ['install', '--yes'], { PATH: dirname(process.execPath) });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /No supported agent was detected/);
    assert.match(r.out, /claude-code/);
    assert.equal(existsSync(box.kit), false);
  });

  test('non-interactive without --agent or --yes installs nothing', () => {
    const box = sandbox('needs-input');
    const r = cli(box, ['install']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Nothing was installed/);
    assert.equal(existsSync(box.kit), false);
  });

  test('installs Claude Code and Codex natively, universal skills as links into the hub, and is idempotent', () => {
    const box = sandbox('main');
    const first = cli(box, ['install', '--agent', 'claude-code', '--agent', 'codex', '--yes']);
    assert.equal(first.code, 0, first.err + first.out);
    assert.match(first.out, /Tier C: the deploy gate is NOT enforced/);
    const link = join(box.home, '.agents', 'skills', 'lua-deploy');
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(readlinkSync(link), join(box.kit, 'current', 'skills', 'lua-deploy'));
    assert.equal(readlinkSync(join(box.kit, 'current')), VERSION);
    const s = state(box);
    assert.equal(s.entries.filter((e) => e.kind === 'native' && e.status === 'ok').length, 2);
    const claude = JSON.parse(readFileSync(join(box.home, '.fake-claude.json'), 'utf8'));
    assert.equal(claude.marketplaces['claude-code-lua-plugin'], join(box.kit, VERSION, 'claude-code'));
    for (const tree of ['claude-code', 'codex']) {
      const diff = spawnSync('diff', ['-r', join(PKG, '..', '..', 'dist', tree), join(box.kit, VERSION, tree)], { encoding: 'utf8' });
      assert.equal(diff.status, 0, `hub ${tree} differs from dist/${tree}:\n${diff.stdout}`);
    }
    const again = cli(box, ['install', '--agent', 'claude-code,codex', '--yes']);
    assert.equal(again.code, 0, again.err);
    assert.doesNotMatch(again.out, /^ {2}(add|re-point|rewrite) /m);
    assert.match(again.out, /plugin already installed/);
    assert.deepEqual(state(box).entries.map((e) => e.path ?? e.source), s.entries.map((e) => e.path ?? e.source));
  });

  test('doctor reports Tier A for Claude Code, Tier B for Codex and a passing gate self-test', () => {
    const box = sandbox('doctor');
    cli(box, ['install', '--agent', 'claude-code,codex', '--yes']);
    const r = cli(box, ['doctor', '--json']);
    assert.equal(r.code, 0, r.err);
    const report = JSON.parse(r.out);
    const host = (id) => report.hosts.find((h) => h.id === id);
    assert.equal(host('claude-code').tier, 'A');
    assert.equal(host('codex').tier, 'B');
    assert.equal(host('claude-code').plugin.gate.ok, true);
    assert.equal(report.universal.tier, 'C');
    assert.equal(report.hub.current, VERSION);
  });

  test('a user-authored skill directory is reported and never touched', () => {
    const box = sandbox('collision');
    const mine = join(box.home, '.claude', 'skills', 'lua-deploy');
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, 'SKILL.md'), 'mine\n');
    const r = cli(box, ['install', '--agent', 'claude-code', '--skills-only', '--yes']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /SKIP\s+.*\.claude\/skills\/lua-deploy: a file or directory this kit did not create/);
    assert.equal(readFileSync(join(mine, 'SKILL.md'), 'utf8'), 'mine\n');
    assert.equal(lstatSync(join(box.home, '.claude', 'skills', 'lua-auth')).isSymbolicLink(), true);
    cli(box, ['uninstall']);
    assert.equal(readFileSync(join(mine, 'SKILL.md'), 'utf8'), 'mine\n');
  });

  test('when symlinks are refused it falls back to copies and records kind copy', () => {
    const box = sandbox('copy');
    const r = cli(box, ['install', '--agent', 'gemini', '--yes'], { LUA_AGENT_KIT_NO_SYMLINKS: '1' });
    assert.equal(r.code, 0, r.err);
    const skill = join(box.home, '.gemini', 'skills', 'lua-deploy');
    assert.equal(lstatSync(skill).isDirectory(), true);
    assert.ok(state(box).entries.every((e) => e.kind === 'copy'));
    const doctor = cli(box, ['doctor']);
    assert.match(doctor.out, /copy mode: update rewrites files in place/);
  });
});

describe('cursor', () => {
  test('writes hooks.json and mcp.json pointing at the hub, doctor shows Tier B with a passing gate, uninstall removes them', () => {
    const box = sandbox('cursor');
    const r = cli(box, ['install', '--agent', 'cursor', '--yes']);
    assert.equal(r.code, 0, r.err + r.out);
    const hooks = JSON.parse(readFileSync(join(box.home, '.cursor', 'hooks.json'), 'utf8'));
    const gate = hooks.hooks.beforeShellExecution.find((h) => h.command.includes('confirm-deploy'));
    assert.equal(gate.failClosed, true);
    assert.ok(gate.command.includes(join(box.kit, VERSION, 'cursor', 'hooks', 'confirm-deploy.mjs')));
    assert.equal(lstatSync(join(box.home, '.cursor', 'skills', 'lua-deploy')).isSymbolicLink(), true);
    const report = JSON.parse(cli(box, ['doctor', '--json']).out);
    const cursor = report.hosts.find((h) => h.id === 'cursor');
    assert.equal(cursor.tier, 'B');
    assert.equal(cursor.plugin.gate.ok, true);
    const up = cli(box, ['update'], { LUA_AGENT_KIT_PAYLOAD: nextPayload });
    assert.equal(up.code, 0, up.err);
    assert.match(readFileSync(join(box.home, '.cursor', 'hooks.json'), 'utf8'), /agent-kit\/99\.0\.0\/cursor/);
    cli(box, ['uninstall']);
    assert.equal(existsSync(join(box.home, '.cursor')), false);
  });

  test('an existing hooks.json is never edited; the rendered file is offered instead', () => {
    const box = sandbox('cursor-mine');
    mkdirSync(join(box.home, '.cursor'), { recursive: true });
    writeFileSync(join(box.home, '.cursor', 'hooks.json'), '{"version":1,"hooks":{}}\n');
    const r = cli(box, ['install', '--agent', 'cursor', '--yes']);
    assert.match(r.out, /merge .*rendered-hooks\.json/);
    assert.equal(readFileSync(join(box.home, '.cursor', 'hooks.json'), 'utf8'), '{"version":1,"hooks":{}}\n');
    const cursor = JSON.parse(cli(box, ['doctor', '--json']).out).hosts.find((h) => h.id === 'cursor');
    assert.equal(cursor.tier, 'C');
  });
});

describe('update and rollback', () => {
  test('update re-points the hub, re-registers the plugins, and --to rolls back', () => {
    const box = sandbox('update');
    cli(box, ['install', '--agent', 'claude-code,codex', '--yes']);
    const up = cli(box, ['update'], { LUA_AGENT_KIT_PAYLOAD: nextPayload });
    assert.equal(up.code, 0, up.err + up.out);
    assert.equal(readlinkSync(join(box.kit, 'current')), '99.0.0');
    assert.equal(existsSync(join(box.home, '.agents', 'skills', 'lua-deploy', 'NEXT.md')), true);
    const claude = JSON.parse(readFileSync(join(box.home, '.fake-claude.json'), 'utf8'));
    assert.equal(claude.marketplaces['claude-code-lua-plugin'], join(box.kit, '99.0.0', 'claude-code'));
    const back = cli(box, ['update', '--to', VERSION], { LUA_AGENT_KIT_PAYLOAD: nextPayload });
    assert.equal(back.code, 0, back.err + back.out);
    assert.equal(readlinkSync(join(box.kit, 'current')), VERSION);
    assert.equal(existsSync(join(box.home, '.agents', 'skills', 'lua-deploy', 'NEXT.md')), false);
  });

  test('update with nothing installed exits 0', () => {
    const box = sandbox('update-empty');
    const r = cli(box, ['update']);
    assert.equal(r.code, 0);
    assert.match(r.out, /Nothing is installed/);
  });
});

describe('project scope and uninstall', () => {
  test('project scope copies, and uninstall leaves git status clean and no residue outside data/', () => {
    const box = sandbox('project');
    mkdirSync(join(box.kit, 'data'), { recursive: true });
    writeFileSync(join(box.kit, 'data', 'keep.txt'), 'x');
    const r = cli(box, ['install', '--project', '--agent', 'claude-code', '--skills-only', '--yes']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /committable/);
    assert.equal(lstatSync(join(box.project, '.claude', 'skills', 'lua-deploy')).isDirectory(), true);
    assert.equal(lstatSync(join(box.project, '.agents', 'skills', 'lua-deploy')).isDirectory(), true);
    const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: box.project, encoding: 'utf8' }).stdout;
    assert.notEqual(dirty.trim(), '');
    const u = cli(box, ['uninstall']);
    assert.equal(u.code, 0, u.err);
    assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: box.project, encoding: 'utf8' }).stdout.trim(), '');
    assert.deepEqual(readdirSync(box.project), ['.git']);
    assert.deepEqual(listAll(box.kit), ['data', 'data/keep.txt']);
  });

  test('uninstall removes links and plugins; an edited copy is left in place', () => {
    const box = sandbox('uninstall');
    cli(box, ['install', '--agent', 'claude-code,codex', '--yes']);
    const u = cli(box, ['uninstall']);
    assert.equal(u.code, 0, u.err);
    assert.equal(existsSync(join(box.home, '.agents')), false);
    assert.equal(existsSync(box.kit), false);
    const claude = JSON.parse(readFileSync(join(box.home, '.fake-claude.json'), 'utf8'));
    assert.deepEqual(claude, { marketplaces: {}, plugins: {} });
    const again = cli(box, ['uninstall']);
    assert.equal(again.code, 0);
    assert.match(again.out, /Nothing to remove/);
  });

  test('a later install for other agents keeps the earlier plugin records, so uninstall still removes them', () => {
    const box = sandbox('additive');
    cli(box, ['install', '--agent', 'claude-code,codex', '--yes']);
    cli(box, ['install', '--agent', 'claude-code', '--skills-only', '--yes']);
    assert.equal(state(box).entries.filter((e) => e.kind === 'native').length, 2);
    cli(box, ['uninstall']);
    const claude = JSON.parse(readFileSync(join(box.home, '.fake-claude.json'), 'utf8'));
    assert.deepEqual(claude, { marketplaces: {}, plugins: {} });
    assert.equal(existsSync(join(box.home, '.claude', 'skills')), false);
  });

  test('an edited copy survives uninstall', () => {
    const box = sandbox('edited');
    cli(box, ['install', '--project', '--agent', 'grok', '--yes']);
    const skill = join(box.project, '.grok', 'skills', 'lua-env', 'SKILL.md');
    writeFileSync(skill, 'edited\n');
    const u = cli(box, ['uninstall']);
    assert.match(u.out, /edited since install, left untouched/);
    assert.equal(readFileSync(skill, 'utf8'), 'edited\n');
  });

  test('a marketplace with our name from somewhere else is never replaced', () => {
    const box = sandbox('foreign');
    writeFileSync(join(box.home, '.fake-claude.json'), JSON.stringify({ marketplaces: { 'claude-code-lua-plugin': 'lua-ai-global/claude-code-lua-plugin' }, plugins: {} }));
    const r = cli(box, ['install', '--agent', 'claude-code', '--yes']);
    assert.match(r.out, /already points at lua-ai-global\/claude-code-lua-plugin; left untouched/);
    const claude = JSON.parse(readFileSync(join(box.home, '.fake-claude.json'), 'utf8'));
    assert.equal(claude.marketplaces['claude-code-lua-plugin'], 'lua-ai-global/claude-code-lua-plugin');
  });
});
