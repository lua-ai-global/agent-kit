import { existingMarketplace, fromHub, ownsMarketplace, runAll, sourceFor } from './native.mjs';

function describe(results) {
  return results.map((r) => `${r.args.join(' ')} -> ${r.status === 0 ? 'ok' : `exit ${r.status}: ${r.stderr.trim().split('\n').pop()}`}`);
}

function classify(existing, source, ctx, recorded) {
  if (!existing.found) return { op: 'install' };
  if (ownsMarketplace(existing.found, source)) return { op: recorded ? 'match' : 'install' };
  if (fromHub(existing.found, ctx.hub.root)) return { op: 'repoint', from: existing.found.source };
  return { op: 'skip', reason: `marketplace already points at ${existing.found.source}; left untouched` };
}

export function planNative(item, ctx, state, version = ctx.payload.version) {
  const source = sourceFor(item.native, ctx.hub.version(version));
  if (ctx.dryRun) return { ...item, source, op: 'install', reason: `would run ${item.native.bin} plugin commands (the host CLI is not called in a dry run)` };
  const existing = existingMarketplace(item.native, ctx.env);
  if (!existing.ok) return { ...item, source, op: 'error', reason: `${item.native.bin} is not usable: ${existing.error}` };
  const recorded = state.entries.find((e) => e.kind === 'native' && e.agent === item.agent && e.status === 'ok');
  return { ...item, source, recorded, ...classify(existing, source, ctx, recorded) };
}

function commandsFor(plan) {
  const { native } = plan;
  if (plan.op === 'match') return [];
  const install = native.install(native, plan.source);
  return plan.op === 'repoint' ? [...native.uninstall(native), ...install] : install;
}

export function applyNative(plan, ctx, install) {
  if (plan.op === 'skip' || plan.op === 'error') return { entry: plan.recorded ?? null, lines: [`${plan.agent}: ${plan.reason}`] };
  const results = runAll(plan.native, commandsFor(plan), ctx.env, { stopOnError: plan.op !== 'repoint' });
  const ok = results.slice(plan.op === 'repoint' ? plan.native.uninstall(plan.native).length : 0).every((r) => r.status === 0);
  const entry = {
    install, agent: plan.agent, kind: 'native', marketplace: plan.native.marketplace, plugin: plan.native.plugin,
    source: plan.source, status: ok ? 'ok' : 'failed',
  };
  const lines = plan.op === 'match' ? [`${plan.agent}: plugin already installed from ${plan.source}`] : describe(results);
  if (ok) lines.push(`${plan.agent}: ${plan.native.next}`);
  return { entry, lines };
}

export function uninstallNative(entry, native, ctx) {
  const existing = existingMarketplace(native, ctx.env);
  if (existing.ok && existing.found && !ownsMarketplace(existing.found, entry.source) && !fromHub(existing.found, ctx.hub.root)) {
    return { ok: true, lines: [`${entry.agent}: marketplace now points at ${existing.found.source}; left untouched`] };
  }
  const results = runAll(native, native.uninstall(native), ctx.env, { stopOnError: false });
  return { ok: results.every((r) => r.status === 0), lines: describe(results) };
}
