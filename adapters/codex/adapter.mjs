import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostDefault, renderHooksJson, renderManifest, renderMcpJson, renderPermissionsTemplate } from '../../build/generators.mjs';
import { applyPairs, applyRules, loadGlossary, unusedGlossaryPaths } from '../../build/glossary.mjs';
import { kitReader } from '../../build/readers.mjs';
import { agentToToml, knowledgeToMdc } from '../../build/transforms.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MCP = 'mcp/lua-platform';
const TEMPLATE_SKILLS = new Set(['lua-qa']);
const SHARED_LIB = ['headless.mjs', 'platform.mjs', 'lua-cli.mjs'];
const GLOSSARY_MCP = ['src/api-client.mjs', 'dist/server.js', 'tests/api-client.test.mjs'];

export const name = 'codex';
export const profile = JSON.parse(readFileSync(join(HERE, 'profile.json'), 'utf8'));

export const mounts = [
  { from: 'adapters/codex/templates', to: '.' },
  { from: 'tools/lint', to: 'scripts' },
  { from: 'packages/core/lib/tokenizer.mjs', to: 'lib/tokenizer.mjs' },
  { from: 'packages/core/lib/credentials.mjs', to: 'lib/credentials.mjs' },
  { from: 'packages/core/lib/host.mjs', to: 'lib/host.mjs' },
  { from: 'packages/core/lib/hook-runtime.mjs', to: 'lib/hook-runtime.mjs' },
  { from: 'packages/core/test/hooks', to: 'test/hooks', exclude: ['block-auth-configure.test.mjs'] },
  { from: 'packages/core/test/lib', to: 'test/lib', exclude: ['hook-runtime.test.mjs'] },
  { from: 'packages/core/test/helpers', to: 'test/helpers' },
  { from: 'packages/core/test/host/host.test.mjs', to: 'test/lib/host.test.mjs' },
  { from: 'packages/mcp-lua-platform', to: MCP, exclude: ['node_modules', 'coverage', 'api-client.mjs', 'server.js', 'api-client.test.mjs'] },
];

function hookModules(root) {
  const registry = JSON.parse(readFileSync(join(root, 'src', 'hooks', 'registry.json'), 'utf8'));
  const ids = Object.values(registry.hosts.codex).flat();
  return [...new Set(ids.map((id) => registry.entries[id].module))].sort();
}

function ruleDescriptions(root) {
  return JSON.parse(readFileSync(join(root, 'src', 'rules', 'descriptions.json'), 'utf8')).rules;
}

export function glossaryTargets(reader, root = ROOT) {
  const glossary = loadGlossary(root, 'codex');
  const rules = (kind, text) => applyRules(glossary, kind, text);
  const descriptions = ruleDescriptions(root);
  const targets = [];
  for (const skill of reader.skills().filter((s) => !TEMPLATE_SKILLS.has(s))) {
    targets.push({ path: `skills/${skill}/SKILL.md`, text: rules('skill', reader.skill(skill)) });
  }
  for (const rule of reader.knowledge()) {
    targets.push({ path: `rules/${rule}.mdc`, text: knowledgeToMdc(rules('rule', reader.knowledgeText(rule)), descriptions[rule].description) });
  }
  for (const agent of reader.agents()) {
    targets.push({ path: `agents/${agent}.toml`, text: agentToToml(rules('agent', reader.agent(agent)), profile.agentModelComment) });
  }
  for (const hook of hookModules(root)) {
    const mode = statSync(join(root, 'packages', 'core', 'hooks', `${hook}.mjs`)).mode & 0o777;
    targets.push({ path: `hooks/${hook}.mjs`, text: reader.hook(hook), mode });
  }
  for (const lib of SHARED_LIB) targets.push({ path: `lib/${lib}`, text: reader.lib(lib) });
  for (const rel of GLOSSARY_MCP) targets.push({ path: `${MCP}/${rel}`, text: reader.mcp(rel), derive: false });
  return { glossary, targets };
}

export function generate({ root, version }) {
  const { glossary, targets } = glossaryTargets(kitReader(root), root);
  const out = targets.map((t) => ({ path: t.path, content: applyPairs(glossary, t.path, t.text), mode: t.mode }));
  const unused = unusedGlossaryPaths(glossary);
  if (unused.length) throw new Error(`codex glossary has entries for paths that are not emitted: ${unused.join(', ')}`);
  return [
    ...out,
    { path: 'lib/host-default.mjs', content: hostDefault(root, profile.defaultHost) },
    { path: 'lib/permissions-template.json', content: renderPermissionsTemplate(root, 'codex') },
    { path: 'hooks/hooks.json', content: renderHooksJson(root, profile) },
    { path: '.mcp.json', content: renderMcpJson(root, profile) },
    { path: '.codex-plugin/plugin.json', content: renderManifest(root, 'adapters/codex/manifests/plugin.json', version) },
    { path: 'marketplace.json', content: renderManifest(root, 'adapters/codex/manifests/marketplace.json', version, {}) },
    { path: '.agents/plugins/marketplace.json', content: renderManifest(root, 'adapters/codex/manifests/agents-marketplace.json', version, {}) },
  ];
}

const TOP_VERSION = '^ {2}"version": "([^"]+)"';

export const stamps = [
  { path: 'package.json', pattern: TOP_VERSION, count: 1 },
  { path: `${MCP}/package.json`, pattern: TOP_VERSION, count: 1 },
  { path: `${MCP}/package-lock.json`, pattern: TOP_VERSION, count: 1 },
  { path: `${MCP}/package-lock.json`, pattern: '"": \\{\\n {6}"name": "[^"]+",\\n {6}"version": "([^"]+)"', count: 1 },
  { path: `${MCP}/src/api-client.mjs`, pattern: "'codex-plugin/([^']+)'", count: 1 },
  { path: `${MCP}/src/server.mjs`, pattern: "version: '([^']+)'", count: 3 },
  { path: `${MCP}/dist/server.js`, pattern: '"codex-plugin/([^"]+)"', count: 1 },
  { path: `${MCP}/dist/server.js`, pattern: 'name:"lua-platform",version:"([^"]+)"', count: 1 },
  { path: `${MCP}/dist/server.js`, pattern: 'plugin_version:"([^"]+)"', count: 2 },
];

export const banner = [];
