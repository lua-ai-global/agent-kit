import { join } from 'node:path';
import { HOSTS, UNIVERSAL, hasAdapter, hostById, readsUniversal } from './hosts.mjs';
import { nativeFor } from './native.mjs';
import { digestTree, isInside, linkOrCopy, linkTarget, pathKind } from './fsops.mjs';

export function baseDir(ctx) {
  return ctx.scope === 'project' ? ctx.cwd : ctx.home;
}

function wantsNative(host, selection, payloadTrees) {
  return hasAdapter(host) && !selection.skillsOnly && Boolean(nativeFor(host.id)) && payloadTrees.includes(host.adapter);
}

function wantsCursorFiles(host, selection, payloadTrees) {
  return host.id === 'cursor' && !selection.skillsOnly && payloadTrees.includes('cursor');
}

function adapterNote(host, selection, filesHost) {
  if (!hasAdapter(host) || selection.skillsOnly || filesHost) return null;
  return `${host.name}: skills only for now.`;
}

export function destinations(selection, ctx, payloadTrees) {
  const base = baseDir(ctx);
  const dirs = new Map([[join(base, UNIVERSAL[ctx.scope]), { agent: 'universal', dir: join(base, UNIVERSAL[ctx.scope]) }]]);
  const natives = [];
  const notes = [];
  let cursorFiles = false;
  for (const id of selection.agents) {
    const host = hostById(id);
    if (wantsNative(host, selection, payloadTrees)) {
      natives.push({ agent: id, native: nativeFor(id) });
      continue;
    }
    const filesHost = wantsCursorFiles(host, selection, payloadTrees);
    cursorFiles ||= filesHost;
    const note = adapterNote(host, selection, filesHost);
    if (note) notes.push(note);
    if (readsUniversal(host, ctx.scope)) continue;
    const dir = join(base, host.skills[ctx.scope]);
    if (!dirs.has(dir)) dirs.set(dir, { agent: id, dir });
  }
  return { dirs: [...dirs.values()], natives, notes, cursorFiles };
}

function recorded(state, path) {
  return state.entries.find((e) => e.path === path && e.kind !== 'native') ?? null;
}

function classifyExisting(path, target, ctx, state) {
  const kind = pathKind(path);
  if (kind === 'none') return { op: 'create' };
  if (kind === 'link') {
    const points = linkTarget(path);
    if (!isInside(points, ctx.hub.root)) return { op: 'skip', reason: `a link to ${points} that this kit did not create` };
    return points === target ? { op: 'match' } : { op: 'repoint' };
  }
  const entry = recorded(state, path);
  if (!entry || entry.kind !== 'copy') return { op: 'skip', reason: 'a file or directory this kit did not create (left untouched)' };
  if (digestTree(path) !== entry.digest) return { op: 'skip', reason: 'a copy this kit wrote, edited since; left untouched' };
  return { op: entry.digest === ctx.sourceDigest(target) ? 'match' : 'rewrite' };
}

export function planSkills(dests, skills, ctx, state) {
  const actions = [];
  for (const { agent, dir } of dests) {
    for (const skill of skills) {
      const path = join(dir, skill);
      const target = join(ctx.linkRoot, 'skills', skill);
      actions.push({ agent, path, target, ...classifyExisting(path, target, ctx, state) });
    }
  }
  return actions;
}

export function applySkill(action, ctx) {
  if (action.op === 'skip') return null;
  const forceCopy = ctx.scope === 'project' || ctx.copy;
  if (action.op === 'match') return entryFor(action, ctx, pathKind(action.path) === 'link' ? 'link' : 'copy');
  const mode = linkOrCopy(action.target, action.path, { forceCopy, symlinks: ctx.symlinks });
  return entryFor(action, ctx, mode);
}

function entryFor(action, ctx, kind) {
  return {
    agent: action.agent, kind, path: action.path, target: action.target, scope: ctx.scope,
    digest: kind === 'copy' ? digestTree(action.path) : ctx.sourceDigest(action.target),
  };
}

export function knownHostIds() {
  return HOSTS.map((h) => h.id);
}
