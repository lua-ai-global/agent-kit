import { dirname, join } from 'node:path';
import { CURSOR_NEXT, applyCursorFile, planCursorFiles } from '../cursor-files.mjs';
import { HOSTS, detectAll } from '../hosts.mjs';
import { materialise, prune, setCurrent } from '../hub.mjs';
import { attachPayload, makeContext, readState, scopeKey, writeState } from '../context.mjs';
import { exists, isInside } from '../fsops.mjs';
import { applyNative, planNative } from '../native-ops.mjs';
import { loadPayload, skillNames } from '../payload.mjs';
import { applySkill, baseDir, destinations, planSkills } from '../plan.mjs';
import { resolveSelection, selectedNames } from '../selection.mjs';
import { listNames } from '../ui.mjs';

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
  io.out(`Would install to: ${selectedNames(plan.selection, plan.ctx).join(', ')}`);
  printActions(plan, io);
}

function actionLine(op, what, reason) {
  return `  ${(OP_TEXT[op] ?? op).padEnd(15)} ${what}${reason ? `: ${reason}` : ''}`;
}

function printActions(plan, io) {
  for (const a of plan.skills) io.out(actionLine(a.op, a.path, a.reason));
  for (const n of plan.natives) io.out(actionLine(n.op, `${n.agent} plugin from ${n.source}`, n.reason));
  for (const f of plan.files) io.out(actionLine(f.op, f.path, f.reason));
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
  const files = dests.cursorFiles ? planCursorFiles(ctx, state) : [];
  const created = missingDirs([...dests.dirs, ...files.map((f) => ({ dir: dirname(f.path) }))], baseDir(ctx));
  return { selection, ctx, state, skills, natives, files, notes: dests.notes, createdDirs: created };
}

function applyFiles(plan, ctx, key, log) {
  const entries = [];
  for (const f of plan.files) {
    const { entry, line } = applyCursorFile(f, key, join(ctx.hub.version(ctx.payload.version), 'cursor'));
    if (entry) entries.push(entry);
    else log.problems.push(line);
  }
  if (entries.some((e) => e.role === 'hooks')) log.next.push(CURSOR_NEXT);
  return entries;
}

export function applyPlan(plan, log = { next: [], problems: [] }) {
  const { ctx, state } = plan;
  const key = scopeKey(ctx);
  const createdDirs = [...new Set([...(state.installs[key]?.createdDirs ?? []), ...plan.createdDirs])];
  materialise(ctx.hub, ctx.payload);
  const currentMode = setCurrent(ctx.hub, ctx.payload.version, { symlinks: ctx.symlinks });
  const entries = plan.skills.map((a) => applySkill(a, ctx)).filter(Boolean).map((e) => ({ ...e, install: key }));
  for (const n of plan.natives) {
    const { entry, next, problems } = applyNative(n, ctx, key);
    if (next) log.next.push(next);
    log.problems.push(...(problems ?? []));
    if (entry) entries.push(entry);
  }
  entries.push(...applyFiles(plan, ctx, key, log));
  const agents = [...new Set([...(state.installs[key]?.agents ?? []), ...plan.selection.agents])];
  const installs = {
    ...state.installs,
    [key]: { scope: ctx.scope, cwd: ctx.cwd, agents, skillsOnly: plan.selection.skillsOnly, copy: ctx.copy, createdDirs },
  };
  writeState(ctx.hub, { ...state, version: ctx.payload.version, current: currentMode, installs, entries: mergeEntries(state.entries, entries) });
  const pruned = prune(ctx.hub);
  return { entries, pruned };
}

function summary(plan, entries, skillCount) {
  const names = selectedNames(plan.selection, plan.ctx);
  const kept = plan.skills.filter((a) => a.op === 'skip').map((a) => a.path);
  const failed = entries.filter((e) => e.status === 'failed').length;
  return { names, kept, failed, headline: `Installed ${skillCount} skills to ${names.length} agents (${listNames(names)})` };
}

function report(resolved, result, log, io) {
  const p = resolved.prompts;
  const say = p ? (t) => p.log.warn(t) : (t) => io.out(t);
  for (const k of result.kept) say(`Left your own folder alone: ${k}`);
  for (const problem of log.problems) say(problem);
  if (p) {
    p.log.success(result.headline);
    p.outro(log.next.length ? log.next.join('\n') : 'Done');
  } else {
    io.out(result.headline);
    for (const n of log.next) io.out(n);
    io.out(`Done${result.failed ? `, ${result.failed} failed` : ''}.`);
  }
}

export async function install(opts, io) {
  const ctx = attachPayload(makeContext(opts, io.env), loadPayload());
  const detected = detectAll(ctx);
  const skillCount = skillNames(ctx.payload.dir).length;
  const resolved = await resolveSelection(opts, detected, ctx, io, skillCount);
  if (!resolved.selection) return handleUnresolved(resolved, io);
  const plan = buildPlan(resolved.selection, ctx);
  if (ctx.dryRun) {
    printPlan(plan, io);
    io.out('Dry run: nothing was written.');
    return 0;
  }
  const spin = resolved.prompts?.spinner();
  spin?.start('Installing');
  const log = { next: [], problems: [] };
  const { entries } = applyPlan(plan, log);
  spin?.stop('Installed');
  const result = summary(plan, entries, skillCount);
  report(resolved, result, log, io);
  return result.failed ? 1 : 0;
}
