import { dirname } from 'node:path';
import { HOSTS, detectAll } from '../hosts.mjs';
import { materialise, prune, setCurrent } from '../hub.mjs';
import { attachPayload, makeContext, readState, scopeKey, writeState } from '../context.mjs';
import { exists, isInside } from '../fsops.mjs';
import { applyNative, planNative } from '../native-ops.mjs';
import { loadPayload, skillNames } from '../payload.mjs';
import { applySkill, baseDir, destinations, planSkills } from '../plan.mjs';
import { resolveSelection, summaryLines, tierNotices } from '../selection.mjs';

const OP_TEXT = {
  create: 'add', repoint: 're-point', rewrite: 'rewrite', match: 'already matches', skip: 'SKIP',
};

function printSupported(io) {
  io.out('No supported agent was detected, so nothing was installed. Supported agents:');
  for (const h of HOSTS) io.out(`  ${h.id.padEnd(12)} ${h.name}`);
  io.out('Install for one explicitly with --agent <id>.');
}

function printNeedsInput(io, detected) {
  io.err('Interactive prompt required but stdin is not a TTY. Nothing was installed.');
  io.err(`Detected: ${detected.length ? detected.join(', ') : 'none'}. Re-run with --agent <id>… or --yes.`);
}

function handleUnresolved(resolved, io) {
  if (resolved.none) {
    printSupported(io);
    return 0;
  }
  if (resolved.needsInput) {
    printNeedsInput(io, resolved.detected);
    return 1;
  }
  io.out('Installation cancelled. Nothing was written.');
  return 0;
}

function printPlan(plan, io) {
  io.out(`Lua Agent Builder ${plan.ctx.payload.version} -> ${plan.ctx.hub.root} (${plan.ctx.scope} scope)`);
  for (const line of summaryLines(plan.selection, plan.ctx)) io.out(`  ${line}`);
  for (const note of plan.notes) io.out(`  note: ${note}`);
  for (const notice of tierNotices(plan.selection)) io.out(notice);
  if (plan.ctx.scope === 'project') {
    io.out('Project scope: these files are copies inside the repository. They are committable and will reach your teammates; project hooks need workspace trust.');
  }
  for (const a of plan.skills) io.out(`  ${OP_TEXT[a.op].padEnd(15)} ${a.path}${a.reason ? `: ${a.reason}` : ''}`);
  for (const n of plan.natives) io.out(`  ${(n.op === 'match' ? 'already matches' : n.op).padEnd(15)} ${n.agent} plugin from ${n.source}${n.reason ? `: ${n.reason}` : ''}`);
}

function missingDirs(dirs, base) {
  const missing = new Set();
  for (const { dir } of dirs) {
    for (let d = dir; d.length > base.length && isInside(d, base) && !exists(d); d = dirname(d)) missing.add(d);
  }
  return [...missing];
}

function entryKey(e) {
  return e.kind === 'native' ? `native:${e.agent}` : `path:${e.path}`;
}

export function mergeEntries(previous, next) {
  const replaced = new Set(next.map(entryKey));
  return [...previous.filter((e) => !replaced.has(entryKey(e))), ...next];
}

export function buildPlan(selection, ctx) {
  const state = readState(ctx.hub);
  const dests = destinations(selection, ctx, ctx.payload.manifest.trees);
  const skills = planSkills(dests.dirs, skillNames(ctx.payload.dir), ctx, state);
  const natives = dests.natives.map((item) => planNative(item, ctx, state));
  return { selection, ctx, state, skills, natives, notes: dests.notes, createdDirs: missingDirs(dests.dirs, baseDir(ctx)) };
}

export function applyPlan(plan, io) {
  const { ctx, state } = plan;
  const key = scopeKey(ctx);
  const createdDirs = [...new Set([...(state.installs[key]?.createdDirs ?? []), ...plan.createdDirs])];
  materialise(ctx.hub, ctx.payload);
  const currentMode = setCurrent(ctx.hub, ctx.payload.version, { symlinks: ctx.symlinks });
  const entries = plan.skills.map((a) => applySkill(a, ctx)).filter(Boolean).map((e) => ({ ...e, install: key }));
  for (const n of plan.natives) {
    const { entry, lines } = applyNative(n, ctx, key);
    for (const line of lines) io.out(`  ${line}`);
    if (entry) entries.push(entry);
  }
  const agents = [...new Set([...(state.installs[key]?.agents ?? []), ...plan.selection.agents])];
  const installs = {
    ...state.installs,
    [key]: { scope: ctx.scope, cwd: ctx.cwd, agents, skillsOnly: plan.selection.skillsOnly, copy: ctx.copy, createdDirs },
  };
  writeState(ctx.hub, { ...state, version: ctx.payload.version, current: currentMode, installs, entries: mergeEntries(state.entries, entries) });
  const pruned = prune(ctx.hub);
  return { entries, pruned };
}

export async function install(opts, io) {
  const ctx = attachPayload(makeContext(opts, io.env), loadPayload());
  const detected = detectAll(ctx);
  const resolved = await resolveSelection(opts, detected, ctx, io);
  if (!resolved.selection) return handleUnresolved(resolved, io);
  const plan = buildPlan(resolved.selection, ctx);
  printPlan(plan, io);
  if (ctx.dryRun) {
    io.out('Dry run: nothing was written.');
    return 0;
  }
  const { entries } = applyPlan(plan, io);
  const skipped = plan.skills.filter((a) => a.op === 'skip').length + plan.natives.filter((n) => n.op === 'skip' || n.op === 'error').length;
  const failed = entries.filter((e) => e.status === 'failed').length;
  io.out(`Done: ${entries.length} recorded in ${ctx.hub.state}${skipped ? `, ${skipped} left untouched` : ''}${failed ? `, ${failed} failed` : ''}.`);
  return failed ? 1 : 0;
}
