import { readdirSync, rmdirSync } from 'node:fs';
import { removeHub } from '../hub.mjs';
import { makeContext, readState, writeState } from '../context.mjs';
import { digestTree, isInside, linkTarget, pathKind, remove } from '../fsops.mjs';
import { nativeFor } from '../native.mjs';
import { uninstallNative } from '../native-ops.mjs';

function removeCreatedDirs(state, keys) {
  const dirs = keys.flatMap((k) => state.installs[k]?.createdDirs ?? []).sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      continue;
    }
  }
}

function removeLink(entry, ctx) {
  if (pathKind(entry.path) !== 'link') return { keep: false, line: `gone already: ${entry.path}` };
  if (!isInside(linkTarget(entry.path), ctx.hub.root)) return { keep: false, line: `not ours any more, left: ${entry.path}` };
  remove(entry.path);
  return { keep: false, line: `removed link ${entry.path}` };
}

function removeCopy(entry) {
  if (pathKind(entry.path) === 'none') return { keep: false, line: `gone already: ${entry.path}` };
  if (digestTree(entry.path) !== entry.digest) return { keep: true, line: `edited since install, left untouched: ${entry.path}` };
  remove(entry.path);
  return { keep: false, line: `removed copy ${entry.path}` };
}

function removeNative(entry, ctx) {
  const result = uninstallNative(entry, nativeFor(entry.agent), ctx);
  return { keep: !result.ok, lines: result.lines };
}

const REMOVERS = { link: removeLink, copy: removeCopy, native: removeNative };

export async function uninstall(opts, io) {
  const ctx = makeContext(opts, io.env);
  const state = readState(ctx.hub);
  const selected = (e) => !opts.agents.length || opts.agents.includes(e.agent);
  const targets = state.entries.filter(selected);
  if (!targets.length) {
    io.out('Nothing to remove.');
    if (!state.entries.length) removeHub(ctx.hub, { purgeData: opts.purgeData });
    return 0;
  }
  const kept = state.entries.filter((e) => !selected(e));
  for (const entry of targets) {
    const result = REMOVERS[entry.kind](entry, ctx);
    for (const line of result.lines ?? [result.line]) io.out(`  ${line}`);
    if (result.keep) kept.push(entry);
  }
  const emptied = Object.keys(state.installs).filter((k) => !kept.some((e) => e.install === k));
  removeCreatedDirs(state, emptied);
  for (const k of emptied) delete state.installs[k];
  if (kept.length) {
    writeState(ctx.hub, { ...state, entries: kept });
    io.out(`Kept ${kept.length} record(s) in ${ctx.hub.state}.`);
    return 0;
  }
  removeHub(ctx.hub, { purgeData: opts.purgeData });
  io.out(`Removed the hub at ${ctx.hub.root}${opts.purgeData ? '' : ' (data/ kept; --purge-data removes it)'}.`);
  return 0;
}
