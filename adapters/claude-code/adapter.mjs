import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readSkill, renderHooksJson, renderManifest, renderMcpJson, renderPermissionsTemplate, skillNames, skillToCommand,
} from '../../build/generators.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = 'plugins/lua-agent-builder';
const MCP = `${PLUGIN}/mcp/lua-platform`;

export const name = 'claude-code';
export const profile = JSON.parse(readFileSync(join(HERE, 'profile.json'), 'utf8'));

export const mounts = [
  { from: 'adapters/claude-code/templates/repo', to: '.' },
  { from: 'adapters/claude-code/templates/plugin', to: PLUGIN },
  { from: 'src/docs/JOB_TIER.md', to: 'docs/JOB_TIER.md' },
  { from: 'packages/core/lib', to: `${PLUGIN}/lib`, exclude: ['host.mjs', 'host-runtime.mjs', 'host-default.mjs'] },
  { from: 'packages/core/hooks', to: `${PLUGIN}/hooks`, exclude: ['before-shell-execution.mjs'] },
  { from: 'packages/core/test/hooks', to: `${PLUGIN}/test/hooks`, exclude: ['before-shell-execution.test.mjs'] },
  { from: 'packages/core/test/lib', to: `${PLUGIN}/test/lib` },
  { from: 'packages/core/test/helpers', to: `${PLUGIN}/test/helpers` },
  { from: 'src/agents', to: `${PLUGIN}/agents` },
  { from: 'qa/agents', to: `${PLUGIN}/agents` },
  { from: 'src/knowledge', to: `${PLUGIN}/lib/knowledge` },
  { from: 'qa/knowledge', to: `${PLUGIN}/lib/knowledge/qa` },
  { from: 'qa/lib', to: `${PLUGIN}/lib/qa` },
  { from: 'qa/test', to: `${PLUGIN}/test/lib/qa` },
  { from: 'qa/hooks', to: `${PLUGIN}/hooks` },
  { from: 'qa/test-hooks', to: `${PLUGIN}/test/hooks` },
  { from: 'packages/mcp-lua-platform', to: MCP, exclude: ['node_modules', 'coverage'] },
];

export function generate({ root, version }) {
  const commands = skillNames(root).map((skill) => ({
    path: `${PLUGIN}/commands/${skill}.md`,
    content: skillToCommand(skill, readSkill(root, skill)),
  }));
  return [
    ...commands,
    { path: `${PLUGIN}/lib/permissions-template.json`, content: renderPermissionsTemplate(root, 'claude-code') },
    { path: `${PLUGIN}/hooks/hooks.json`, content: renderHooksJson(root, profile) },
    { path: `${PLUGIN}/.mcp.json`, content: renderMcpJson(root, profile) },
    { path: `${PLUGIN}/.claude-plugin/plugin.json`, content: renderManifest(root, 'adapters/claude-code/manifests/plugin.json', version) },
    { path: '.claude-plugin/marketplace.json', content: renderManifest(root, 'adapters/claude-code/manifests/marketplace.json', version) },
  ];
}

const TOP_VERSION = '^ {2}"version": "([^"]+)"';

export const stamps = [
  { path: `${PLUGIN}/package.json`, pattern: TOP_VERSION, count: 1 },
  { path: `${MCP}/package.json`, pattern: TOP_VERSION, count: 1 },
  { path: `${MCP}/package-lock.json`, pattern: TOP_VERSION, count: 1 },
  { path: `${MCP}/package-lock.json`, pattern: '"": \\{\\n {6}"name": "[^"]+",\\n {6}"version": "([^"]+)"', count: 1 },
  { path: `${MCP}/src/api-client.mjs`, pattern: "'claude-plugin/([^']+)'", count: 1 },
  { path: `${MCP}/src/server.mjs`, pattern: "version: '([^']+)'", count: 3 },
  { path: `${MCP}/dist/server.js`, pattern: '"claude-plugin/([^"]+)"', count: 1 },
  { path: `${MCP}/dist/server.js`, pattern: 'name:"lua-platform",version:"([^"]+)"', count: 1 },
  { path: `${MCP}/dist/server.js`, pattern: 'plugin_version:"([^"]+)"', count: 2 },
];

export const banner = ['README.md'];
