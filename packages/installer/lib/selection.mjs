import { HOSTS, TIER_TEXT, UNIVERSAL, additionalHosts, hasAdapter, hostById, readsUniversal, universalHosts } from './hosts.mjs';

export function displayPath(ctx, rel) {
  return ctx.scope === 'project' ? rel : `~/${rel}`;
}

export function hostLabel(host) {
  return hasAdapter(host) ? `${host.name} (+ safety hooks)` : host.name;
}

export function hostHint(host, ctx) {
  return displayPath(ctx, host.skills[ctx.scope]);
}

export function summaryLines(selection, ctx) {
  const universal = universalHosts(ctx.scope).map((h) => h.name).join(', ');
  const lines = [`Universal skills at ${displayPath(ctx, UNIVERSAL[ctx.scope])} (${universal}): Tier C`];
  for (const id of selection.agents) {
    const host = hostById(id);
    if (hasAdapter(host) && !selection.skillsOnly) lines.push(`${host.name}: Lua Agent Builder plugin with safety hooks, Tier ${host.tier}`);
    else if (!readsUniversal(host, ctx.scope)) lines.push(`${host.name}: skills at ${hostHint(host, ctx)}, Tier C`);
    else lines.push(`${host.name}: reads the universal skills, Tier C`);
  }
  return lines;
}

export function tierNotices(selection) {
  const tiers = new Set(['C']);
  for (const id of selection.agents) {
    const host = hostById(id);
    tiers.add(hasAdapter(host) && !selection.skillsOnly ? host.tier : 'C');
  }
  return ['A', 'B', 'C'].filter((t) => tiers.has(t)).map((t) => TIER_TEXT[t]);
}

export function parseAgents(values) {
  const ids = values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  if (ids.includes('*')) return HOSTS.map((h) => h.id);
  for (const id of ids) hostById(id);
  return [...new Set(ids)];
}

function detectedIds(detected) {
  return Object.entries(detected).filter(([, d]) => d.present).map(([id]) => id);
}

async function pick(ctx, detected, prompts) {
  const universal = universalHosts(ctx.scope).map((h) => `  ${h.name}`).join('\n');
  prompts.intro('Lua Agent Builder');
  prompts.note(`${universal}\n  at ${displayPath(ctx, UNIVERSAL[ctx.scope])}`, 'Universal (.agents/skills): always included');
  const options = additionalHosts(ctx.scope).map((h) => ({ value: h.id, label: hostLabel(h), hint: hostHint(h, ctx) }));
  const initialValues = detectedIds(detected).filter((id) => options.some((o) => o.value === id));
  const agents = await prompts.autocompleteMultiselect({ message: 'Additional agents (type to search, Tab to select, Enter to confirm)', options, initialValues, required: false });
  if (prompts.isCancel(agents)) return null;
  return { agents, skillsOnly: false };
}

async function confirmSelection(selection, ctx, prompts) {
  prompts.note([...summaryLines(selection, ctx), '', ...tierNotices(selection)].join('\n'), 'Selected');
  const ok = await prompts.confirm({ message: 'Install these now?', initialValue: true });
  return !prompts.isCancel(ok) && ok === true;
}

export async function resolveSelection(opts, detected, ctx, io) {
  if (opts.agents.length) return { selection: { agents: parseAgents(opts.agents), skillsOnly: opts.skillsOnly } };
  if (opts.yes) {
    const agents = detectedIds(detected);
    if (agents.length === 0) return { none: true };
    return { selection: { agents, skillsOnly: opts.skillsOnly } };
  }
  if (!io.interactive) return { needsInput: true, detected: detectedIds(detected) };
  const prompts = await io.prompts();
  const selection = await pick(ctx, detected, prompts);
  if (!selection) return { cancelled: true };
  selection.skillsOnly = opts.skillsOnly;
  if (!opts.dryRun && !(await confirmSelection(selection, ctx, prompts))) return { cancelled: true };
  return { selection, confirmed: true };
}
