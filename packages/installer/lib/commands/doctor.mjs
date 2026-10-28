import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HOSTS, TIER_TEXT, detectAll, hasAdapter } from '../hosts.mjs';
import { currentVersion, hubVersions } from '../hub.mjs';
import { makeContext, readState } from '../context.mjs';
import { exists, pathKind } from '../fsops.mjs';
import { existingMarketplace, nativeFor, ownsMarketplace } from '../native.mjs';

const GATE_HOOKS = {
  'claude-code': { path: 'plugins/lua-agent-builder/hooks/confirm-deploy.mjs', env: { CLAUDE_PLUGIN_ROOT: '1' } },
  codex: { path: 'hooks/confirm-deploy.mjs', env: { PLUGIN_ROOT: '1' } },
  cursor: { path: 'hooks/confirm-deploy.mjs', env: { CURSOR_TRACE_ID: 'doctor' }, flat: true },
};

export function credentialSources(env, home, cwd) {
  const sources = [];
  if (Object.prototype.hasOwnProperty.call(env, 'LUA_API_KEY')) sources.push('env');
  if (exists(join(cwd, '.env'))) sources.push('dotenv (a .env file is present; its contents are not read)');
  const sessions = join(home, '.lua-cli', 'sessions');
  if (exists(sessions) && readdirSync(sessions).some((f) => f.endsWith('.json'))) sources.push('session');
  if (exists(join(home, '.lua-cli', 'credentials'))) sources.push('credentials-file');
  return sources;
}

function gateSelfTest(agent, source, ctx) {
  const hook = GATE_HOOKS[agent];
  const script = join(source, hook.path);
  if (!exists(script)) return { ok: false, detail: `gate hook missing at ${script}` };
  const input = hook.flat ? { command: 'lua deploy all', cwd: ctx.home } : { tool_name: 'Bash', tool_input: { command: 'lua deploy all' } };
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 20_000, env: { PATH: ctx.env.PATH, HOME: ctx.home, ...hook.env },
  });
  const blocked = hook.flat ? /"permission":"deny"/.test(r.stdout) : r.status === 2;
  return { ok: blocked, detail: blocked ? 'a bare `lua deploy all` is blocked' : `NOT blocked (exit ${r.status})` };
}

function nativeStatus(agent, entry, ctx) {
  const native = nativeFor(agent);
  const existing = existingMarketplace(native, ctx.env);
  const registered = existing.ok && ownsMarketplace(existing.found, entry.source);
  const loadedFrom = native.loadedFrom(entry.source, { env: ctx.env, home: ctx.home });
  return { registered, marketplace: native.marketplace, source: entry.source, loadedFrom, gate: gateSelfTest(agent, loadedFrom, ctx), next: native.next };
}

function hostReport(host, ctx, state, detected) {
  const entries = state.entries.filter((e) => e.agent === host.id);
  const native = entries.find((e) => e.kind === 'native');
  const tier = native ? host.tier : 'C';
  return {
    id: host.id, name: host.name, adapter: hasAdapter(host), detected: detected[host.id], installed: entries.length > 0, tier, tierText: TIER_TEXT[tier],
    links: entries.filter((e) => e.kind === 'link').length, copies: entries.filter((e) => e.kind === 'copy').length,
    plugin: native ? nativeStatus(host.id, native, ctx) : null,
  };
}

export function buildReport(ctx) {
  const state = readState(ctx.hub);
  const detected = detectAll(ctx);
  const universal = state.entries.filter((e) => e.agent === 'universal');
  return {
    hub: { root: ctx.hub.root, current: currentVersion(ctx.hub), mode: pathKind(ctx.hub.current), versions: hubVersions(ctx.hub.root) },
    universal: { links: universal.filter((e) => e.kind === 'link').length, copies: universal.filter((e) => e.kind === 'copy').length, tier: 'C', tierText: TIER_TEXT.C },
    hosts: HOSTS.map((h) => hostReport(h, ctx, state, detected)),
    credentialSources: credentialSources(ctx.env, ctx.home, ctx.cwd),
  };
}

function seenText(detected) {
  if (!detected.present) return 'not detected';
  return `detected (${[detected.configDir && 'config dir', detected.binary && 'binary'].filter(Boolean).join(', ')})`;
}

function printPlugin(h, io) {
  io.out(`  plugin: marketplace "${h.plugin.marketplace}" ${h.plugin.registered ? 'registered from the hub' : 'NOT registered from the hub'}`);
  io.out(`  gate self-test on ${h.plugin.loadedFrom}: ${h.plugin.gate.ok ? 'ok' : 'FAILED'}, ${h.plugin.gate.detail}`);
  if (h.id === 'codex') io.out(`  ${h.plugin.next}`);
}

function printHost(h, io) {
  io.out(`${h.name}: ${seenText(h.detected)}; ${h.installed ? `installed, Tier ${h.tier}` : 'not installed'}`);
  if (!h.installed) return;
  const copyNote = h.copies ? ' (copy mode: update rewrites files in place)' : '';
  if (h.links || h.copies) io.out(`  skills: ${h.links} link(s), ${h.copies} copy(ies)${copyNote}`);
  if (h.plugin) printPlugin(h, io);
  io.out(`  ${h.tierText}`);
}

function printReport(report, io) {
  const hub = report.hub;
  io.out(`hub: ${hub.root} (current ${hub.current ?? 'none'}, ${hub.mode}; kept: ${hub.versions.join(', ') || 'none'})`);
  io.out(`universal skills: ${report.universal.links} link(s), ${report.universal.copies} copy(ies). ${report.universal.tierText}`);
  for (const h of report.hosts) if (h.installed || h.detected.present || h.adapter) printHost(h, io);
  io.out(`credential source: ${report.credentialSources.join(', ') || 'none found'} (values are never read)`);
}

export async function doctor(opts, io) {
  const report = buildReport(makeContext(opts, io.env));
  if (opts.json) io.out(JSON.stringify(report, null, 2));
  else printReport(report, io);
  return report.hosts.some((h) => h.plugin && !h.plugin.gate.ok) ? 1 : 0;
}
