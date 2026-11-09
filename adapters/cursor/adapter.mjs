import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostDefault, renderCursorHooks, renderCursorMcp, renderManifest } from '../../build/generators.mjs';
import { applyPairs, loadGlossary } from '../../build/glossary.mjs';
import { kitReader } from '../../build/readers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED_LIB = ['headless.mjs', 'platform.mjs', 'lua-cli.mjs'];

export const name = 'cursor';
export const profile = JSON.parse(readFileSync(join(HERE, 'profile.json'), 'utf8'));
export const stamps = [];
export const banner = [];

export const mounts = [
  { from: 'packages/core/lib/tokenizer.mjs', to: 'lib/tokenizer.mjs' },
  { from: 'packages/core/lib/credentials.mjs', to: 'lib/credentials.mjs' },
  { from: 'packages/core/lib/host.mjs', to: 'lib/host.mjs' },
  { from: 'packages/core/lib/hook-runtime.mjs', to: 'lib/hook-runtime.mjs' },
  { from: 'packages/core/lib/lua-bin.mjs', to: 'lib/lua-bin.mjs' },
  { from: 'packages/mcp-lua-platform/dist', to: 'mcp/lua-platform/dist' },
  { from: 'packages/mcp-lua-platform/package.json', to: 'mcp/lua-platform/package.json' },
];

function hookModules(root) {
  const registry = JSON.parse(readFileSync(join(root, 'src', 'hooks', 'registry.json'), 'utf8'));
  return [...new Set(Object.values(registry.hosts.cursor).flat().map((id) => registry.entries[id].module))].sort();
}

function hostText(codex, cursor, path, text) {
  return applyPairs(cursor, path, applyPairs(codex, path, text));
}

export function generate({ root, version }) {
  const reader = kitReader(root);
  const codex = loadGlossary(root, 'codex');
  const cursor = loadGlossary(root, 'cursor');
  const out = [];
  for (const hook of hookModules(root)) {
    const path = `hooks/${hook}.mjs`;
    const mode = statSync(join(root, 'packages', 'core', 'hooks', `${hook}.mjs`)).mode & 0o777;
    out.push({ path, content: hostText(codex, cursor, path, reader.hook(hook)), mode });
  }
  for (const lib of SHARED_LIB) out.push({ path: `lib/${lib}`, content: hostText(codex, cursor, `lib/${lib}`, reader.lib(lib)) });
  return [
    ...out,
    { path: 'lib/host-default.mjs', content: hostDefault(root, 'cursor') },
    { path: 'package.json', content: `${JSON.stringify({ name: 'lua-agent-builder-cursor', private: true, type: 'module' }, null, 2)}\n` },
    { path: '.cursor-plugin/plugin.json', content: renderManifest(root, 'adapters/cursor/manifests/plugin.json', version) },
    { path: 'hooks/hooks.json', content: renderCursorHooks(root) },
    { path: 'mcp.json', content: renderCursorMcp(root) },
  ];
}
