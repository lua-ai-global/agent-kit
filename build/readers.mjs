import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function names(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();
}

function read(path) {
  return readFileSync(path, 'utf8');
}

export function kitReader(root) {
  return {
    skills: () => readdirSync(join(root, 'src', 'skills')).filter((n) => !n.startsWith('.')).sort(),
    skill: (name) => read(join(root, 'src', 'skills', name, 'SKILL.md')),
    knowledge: () => names(join(root, 'src', 'knowledge'), '.md'),
    knowledgeText: (name) => read(join(root, 'src', 'knowledge', `${name}.md`)),
    agents: () => names(join(root, 'src', 'agents'), '.md'),
    agent: (name) => read(join(root, 'src', 'agents', `${name}.md`)),
    hooks: () => names(join(root, 'packages', 'core', 'hooks'), '.mjs'),
    hook: (name) => read(join(root, 'packages', 'core', 'hooks', `${name}.mjs`)),
    lib: (name) => read(join(root, 'packages', 'core', 'lib', name)),
    mcp: (rel) => read(join(root, 'packages', 'mcp-lua-platform', rel)),
  };
}

export function claudePluginReader(pluginDir, overrides = {}) {
  return {
    skills: () => names(join(pluginDir, 'commands'), '.md'),
    skill: (name) => read(join(pluginDir, 'commands', `${name}.md`)).replace(/^---\n/, `---\nname: ${name}\n`),
    knowledge: () => names(join(pluginDir, 'lib', 'knowledge'), '.md'),
    knowledgeText: (name) => read(join(pluginDir, 'lib', 'knowledge', `${name}.md`)),
    agents: () => names(join(pluginDir, 'agents'), '.md').filter((n) => !n.startsWith('lua-qa')),
    agent: (name) => read(join(pluginDir, 'agents', `${name}.md`)),
    hooks: () => names(join(pluginDir, 'hooks'), '.mjs'),
    hook: (name) => read(overrides.hooks?.[name] ?? join(pluginDir, 'hooks', `${name}.mjs`)),
    lib: (name) => read(join(pluginDir, 'lib', name)),
    mcp: (rel) => read(join(pluginDir, 'mcp', 'lua-platform', rel)),
  };
}
