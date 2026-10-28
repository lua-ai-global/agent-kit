import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatJson } from './json-format.mjs';

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

export function skillNames(root) {
  return readdirSync(join(root, 'src', 'skills')).filter((n) => !n.startsWith('.')).sort();
}

export function readSkill(root, name) {
  return readFileSync(join(root, 'src', 'skills', name, 'SKILL.md'), 'utf8');
}

export function skillToCommand(name, text) {
  const nameLine = `---\nname: ${name}\n`;
  if (!text.startsWith(nameLine)) throw new Error(`skill ${name}: frontmatter must open with name: ${name}`);
  return `---\n${text.slice(nameLine.length)}`;
}

function appliesTo(row, host) {
  return typeof row === 'string' || row.hosts.includes(host);
}

export function permissionRules(root, host) {
  const { tiers } = readJson(root, 'src/permissions/rules.json');
  const out = {};
  for (const [tier, rows] of Object.entries(tiers)) {
    out[tier] = rows.filter((row) => appliesTo(row, host)).map((row) => (typeof row === 'string' ? row : row.rule));
  }
  return out;
}

export function renderPermissionsTemplate(root, host) {
  const comment = readFileSync(join(root, 'src', 'permissions', `comment.${host}.json`), 'utf8').trimEnd();
  const marker = '"__LUA_KIT_COMMENT__"';
  const body = JSON.stringify({ _comment: '__LUA_KIT_COMMENT__', permissions: permissionRules(root, host) }, null, 2);
  return `${body.replace(marker, comment)}\n`;
}

function hookHandler(entry, profile, host) {
  const handler = { type: 'command', command: `node ${profile.pluginRoot}hooks/${entry.module}.mjs` };
  if (profile.hookFilters && entry.if) handler.if = entry.if;
  handler.timeout = entry.timeoutBy?.[host] ?? entry.timeout;
  return handler;
}

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

export function renderHooksJson(root, profile) {
  const registry = readJson(root, 'src/hooks/registry.json');
  const plan = registry.hosts[profile.host];
  const hooks = {};
  for (const [event, ids] of Object.entries(plan)) {
    const group = TOOL_EVENTS.has(event) ? { matcher: profile.toolMatcher } : {};
    group.hooks = ids.map((id) => hookHandler(registry.entries[id], profile, profile.host));
    hooks[event] = [group];
  }
  return formatJson({ hooks }, profile.hooksJsonStyle);
}

function mcpServer(server, profile) {
  if (server.transport !== 'stdio') return { type: server.transport, url: server.url };
  const out = { command: server.command, args: [`${profile.pluginRoot}${server.entry}`] };
  if (profile.mcpEnvSpelling && server.env?.length) {
    out.env = Object.fromEntries(server.env.map((name) => [name, profile.mcpEnvSpelling.replace('NAME', name)]));
  }
  return out;
}

export function renderMcpJson(root, profile) {
  const { servers } = readJson(root, 'src/mcp/servers.json');
  const mcpServers = Object.fromEntries(Object.entries(servers).map(([k, v]) => [k, mcpServer(v, profile)]));
  return formatJson({ mcpServers }, profile.mcpStyle);
}

export function renderManifest(root, rel, version, style = { inlinePrimitiveArrays: true }) {
  const manifest = readJson(root, rel);
  if ('version' in manifest) manifest.version = version;
  for (const plugin of manifest.plugins ?? []) if ('version' in plugin) plugin.version = version;
  return formatJson(manifest, style);
}
