import { basename, dirname, join } from 'node:path';
import { applyCursorFile, planCursorFiles } from '../cursor-files.mjs';
import { currentVersion, hubVersions, materialise, prune, setCurrent } from '../hub.mjs';
import { attachPayload, makeContext, readState, writeState } from '../context.mjs';
import { nativeFor } from '../native.mjs';
import { applyNative, planNative } from '../native-ops.mjs';
import { loadPayload, skillNames } from '../payload.mjs';
import { applySkill, planSkills } from '../plan.mjs';

function targetVersion(opts, ctx, payload) {
  const wanted = opts.to ?? payload.version;
  if (wanted === payload.version) return { version: wanted, materialise: true };
  if (hubVersions(ctx.hub.root).includes(wanted)) return { version: wanted, materialise: false };
  return { error: `version ${wanted} is neither this package's payload (${payload.version}) nor kept in ${ctx.hub.root} (${hubVersions(ctx.hub.root).join(', ') || 'none'})` };
}

function refreshCopies(state, ctx, filter) {
  const skills = new Set(skillNames(ctx.hub.version(ctx.targetVersion)));
  const updated = [];
  for (const entry of state.entries.filter((e) => e.kind === 'copy' && filter(e) && skills.has(basename(e.path)))) {
    const [action] = planSkills([{ agent: entry.agent, dir: dirname(entry.path) }], [basename(entry.path)], ctx, state);
    if (action.op !== 'rewrite') continue;
    Object.assign(entry, applySkill(action, { ...ctx, scope: entry.scope, copy: true }));
    updated.push(entry.path);
  }
  return updated;
}

function switchVersion(ctx, payload, target) {
  const previous = currentVersion(ctx.hub);
  if (target.materialise) materialise(ctx.hub, payload);
  else attachPayload(ctx, { ...payload, dir: ctx.hub.version(target.version) });
  ctx.targetVersion = target.version;
  setCurrent(ctx.hub, target.version, { symlinks: ctx.symlinks });
  return previous;
}

function rewriteCursorFiles(state, ctx, filter, io) {
  const recorded = state.entries.filter((e) => e.kind === 'file' && filter(e));
  for (const entry of recorded) {
    const scoped = { ...ctx, scope: entry.install.startsWith('project:') ? 'project' : 'user', cwd: entry.install.replace(/^project:/, '') };
    const plan = planCursorFiles(scoped, state, ctx.targetVersion).find((p) => p.path === entry.path);
    if (!plan) continue;
    const { entry: next, line } = applyCursorFile(plan, entry.install, join(ctx.hub.version(ctx.targetVersion), 'cursor'));
    if (next) Object.assign(entry, next);
    else io.out(line);
  }
}

async function repointNatives(state, ctx, filter, io) {
  rewriteCursorFiles(state, ctx, filter, io);
  for (const entry of state.entries.filter((e) => e.kind === 'native' && filter(e))) {
    const plan = await planNative({ agent: entry.agent, native: nativeFor(entry.agent) }, ctx, state, ctx.targetVersion);
    const { entry: next, problems } = await applyNative(plan, ctx, entry.install);
    for (const problem of problems ?? []) io.out(problem);
    if (next) Object.assign(entry, next);
  }
}

export async function update(opts, io) {
  const payload = loadPayload();
  const ctx = attachPayload(makeContext(opts, io.env), payload);
  const state = readState(ctx.hub);
  if (!state.entries.length) {
    io.out('Nothing is installed; run `npx lua-agent-kit install` first.');
    return 0;
  }
  const target = targetVersion(opts, ctx, payload);
  if (target.error) {
    io.err(target.error);
    return 1;
  }
  const previous = switchVersion(ctx, payload, target);
  const filter = (e) => !opts.agents.length || opts.agents.includes(e.agent);
  refreshCopies(state, ctx, filter);
  await repointNatives(state, ctx, filter, io);
  writeState(ctx.hub, { ...state, version: target.version, previous });
  prune(ctx.hub);
  io.out(`Updated to ${target.version}${previous && previous !== target.version ? ` (from ${previous})` : ''}.`);
  if (previous && previous !== target.version) io.out(`Roll back with: npx lua-agent-kit update --to ${previous}`);
  return 0;
}
