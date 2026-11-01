import { HOSTS, UNIVERSAL, additionalHosts, hostById, universalHosts } from './hosts.mjs';
import { banner, listNames } from './ui.mjs';

export function displayPath(ctx, rel) {
  return ctx.scope === 'project' ? rel : `~/${rel}`;
}

export function hostHint(host, ctx) {
  return displayPath(ctx, host.skills[ctx.scope]);
}

export function selectedNames(selection, ctx) {
  const names = universalHosts(ctx.scope).map((h) => h.name);
  for (const id of selection.agents) {
    const name = hostById(id).name;
    if (!names.includes(name)) names.push(name);
  }
  return names;
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

async function pick(ctx, detected, prompts, skillCount) {
  process.stdout.write(banner(true));
  prompts.intro('lua-agent-kit');
  prompts.log.step(`Found ${skillCount} skills`);
  const universal = universalHosts(ctx.scope).map((h) => `● ${h.name}`).join('\n');
  prompts.note(universal, `Universal (${displayPath(ctx, UNIVERSAL[ctx.scope])}) · always included`);
  const options = additionalHosts(ctx.scope).map((h) => ({ value: h.id, label: h.name, hint: hostHint(h, ctx) }));
  const initialValues = detectedIds(detected).filter((id) => options.some((o) => o.value === id));
  const agents = await prompts.autocompleteMultiselect({ message: 'Which agents do you want to install to?', options, initialValues, required: false });
  if (prompts.isCancel(agents)) return null;
  return { agents, skillsOnly: false };
}

async function confirmSelection(selection, ctx, prompts) {
  const names = selectedNames(selection, ctx);
  prompts.log.info(`Selected: ${listNames(names)}`);
  const ok = await prompts.confirm({ message: `Install to ${names.length} agents?`, initialValue: true });
  return !prompts.isCancel(ok) && ok === true;
}

export async function resolveSelection(opts, detected, ctx, io, skillCount) {
  if (opts.agents.length) return { selection: { agents: parseAgents(opts.agents), skillsOnly: opts.skillsOnly } };
  if (opts.yes) {
    const agents = detectedIds(detected);
    if (agents.length === 0) return { none: true };
    return { selection: { agents, skillsOnly: opts.skillsOnly } };
  }
  if (!io.interactive) return { needsInput: true, detected: detectedIds(detected) };
  const prompts = await io.prompts();
  const selection = await pick(ctx, detected, prompts, skillCount);
  if (!selection) return { cancelled: true };
  selection.skillsOnly = opts.skillsOnly;
  if (!opts.dryRun && !(await confirmSelection(selection, ctx, prompts))) return { cancelled: true };
  return { selection, confirmed: true, prompts };
}
