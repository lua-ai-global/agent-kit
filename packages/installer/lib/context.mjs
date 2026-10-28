import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { relative, resolve, join } from 'node:path';
import { digestTree, exists } from './fsops.mjs';
import { hubPaths, kitHome, writeJsonAtomic } from './hub.mjs';

export const STATE_SCHEMA = 1;

export function makeContext(opts, env = process.env) {
  const home = homedir();
  const hub = hubPaths(kitHome(env, home));
  return {
    env,
    home,
    cwd: resolve(opts.cwd ?? process.cwd()),
    scope: opts.project ? 'project' : 'user',
    copy: Boolean(opts.copy),
    dryRun: Boolean(opts.dryRun),
    symlinks: !env.LUA_AGENT_KIT_NO_SYMLINKS && process.platform !== 'win32',
    hub,
    linkRoot: hub.current,
  };
}

export function attachPayload(ctx, payload) {
  const cache = new Map();
  ctx.payload = payload;
  ctx.sourceDigest = (target) => {
    const inPayload = join(payload.dir, relative(ctx.linkRoot, target));
    if (!cache.has(inPayload)) cache.set(inPayload, exists(inPayload) ? digestTree(inPayload) : null);
    return cache.get(inPayload);
  };
  return ctx;
}

export function readState(hub) {
  if (!exists(hub.state)) return { schema: STATE_SCHEMA, version: null, installs: {}, entries: [] };
  const state = JSON.parse(readFileSync(hub.state, 'utf8'));
  return { installs: {}, entries: [], ...state };
}

export function writeState(hub, state) {
  writeJsonAtomic(hub.state, { ...state, schema: STATE_SCHEMA, updatedAt: new Date().toISOString() });
}

export function scopeKey(ctx) {
  return ctx.scope === 'project' ? `project:${ctx.cwd}` : 'user';
}

export function entriesFor(state, key) {
  return state.entries.filter((e) => e.install === key);
}
