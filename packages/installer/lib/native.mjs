import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

function manifestVersion(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

export const NATIVE = {
  'claude-code': {
    bin: 'claude',
    tree: 'claude-code',
    marketplace: 'claude-code-lua-plugin',
    plugin: 'lua-agent-builder@claude-code-lua-plugin',
    listMarketplaces: ['plugin', 'marketplace', 'list', '--json'],
    marketplacesOf: (json) => json.map((m) => ({ name: m.name, source: m.path ?? m.installLocation ?? m.repo ?? m.url })),
    install: (n, source) => [['plugin', 'marketplace', 'add', source], ['plugin', 'install', n.plugin, '--scope', 'user']],
    uninstall: (n) => [['plugin', 'uninstall', n.plugin], ['plugin', 'marketplace', 'remove', n.marketplace]],
    loadedFrom: (source) => source,
    next: 'Start a new Claude Code session; run /lua-doctor once to offer the permission template.',
  },
  codex: {
    bin: 'codex',
    tree: 'codex',
    marketplace: 'lua-ai-marketplace',
    plugin: 'lua-agent-builder@lua-ai-marketplace',
    listMarketplaces: ['plugin', 'marketplace', 'list', '--json'],
    marketplacesOf: (json) => (json.marketplaces ?? []).map((m) => ({ name: m.name, source: m.marketplaceSource?.source ?? m.root })),
    install: (n, source) => [['plugin', 'marketplace', 'add', source], ['plugin', 'add', n.plugin]],
    uninstall: (n) => [['plugin', 'remove', n.plugin], ['plugin', 'marketplace', 'remove', n.marketplace]],
    loadedFrom: (source, { env, home }) => join(
      env.CODEX_HOME || join(home, '.codex'), 'plugins', 'cache', 'lua-ai-marketplace', 'lua-agent-builder', manifestVersion(join(source, '.codex-plugin', 'plugin.json')),
    ),
    next: 'Open Codex and run /hooks to review and trust the Lua Agent Builder hooks. Until you do, the deploy gate is not armed and Codex is Tier C.',
  },
};

export function nativeFor(id) {
  return NATIVE[id] ?? null;
}

function binFor(native, env) {
  const override = env[`LUA_AGENT_KIT_${native.bin.toUpperCase()}_BIN`];
  return override || native.bin;
}

export function runHostCommand(native, args, env) {
  const r = spawnSync(binFor(native, env), args, { env, encoding: 'utf8', timeout: 120_000 });
  return { args, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error?.message ?? '') };
}

export function existingMarketplace(native, env) {
  const r = runHostCommand(native, native.listMarketplaces, env);
  if (r.status !== 0) return { ok: false, error: r.stderr.trim() || `exit ${r.status}` };
  try {
    const found = native.marketplacesOf(JSON.parse(r.stdout)).find((m) => m.name === native.marketplace);
    return { ok: true, found: found ?? null };
  } catch (err) {
    return { ok: false, error: `could not parse marketplace list: ${err.message}` };
  }
}

function real(path) {
  const absolute = resolve(String(path));
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(real(parent), basename(absolute));
  }
}

export function sourceFor(native, versionDir) {
  return real(join(versionDir, native.tree));
}

export function ownsMarketplace(found, source) {
  return Boolean(found) && real(found.source) === real(source);
}

export function fromHub(found, hubRoot) {
  if (!found) return false;
  const rel = relative(real(hubRoot), real(found.source));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function runAll(native, commands, env, { stopOnError = true } = {}) {
  const results = [];
  for (const args of commands) {
    const r = runHostCommand(native, args, env);
    results.push(r);
    if (r.status !== 0 && stopOnError) break;
  }
  return results;
}
