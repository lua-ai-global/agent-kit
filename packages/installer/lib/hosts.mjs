import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const UNIVERSAL = Object.freeze({ user: '.agents/skills', project: '.agents/skills' });

export const HOSTS = Object.freeze([
  {
    id: 'claude-code', name: 'Claude Code', tier: 'A', adapter: 'claude-code', bin: 'claude', config: '.claude',
    skills: { user: '.claude/skills', project: '.claude/skills' },
  },
  {
    id: 'codex', name: 'Codex', tier: 'B', adapter: 'codex', bin: 'codex', config: '.codex',
    skills: { user: '.agents/skills', project: '.agents/skills' },
  },
  {
    id: 'cursor', name: 'Cursor', tier: 'B', adapter: 'cursor', bin: 'cursor-agent', config: '.cursor',
    skills: { user: '.cursor/skills', project: '.agents/skills' },
  },
  {
    id: 'gemini', name: 'Gemini CLI', tier: 'C', bin: 'gemini', config: '.gemini',
    skills: { user: '.gemini/skills', project: '.agents/skills' },
  },
  {
    id: 'copilot', name: 'GitHub Copilot CLI', tier: 'C', bin: 'copilot', config: '.copilot',
    skills: { user: '.agents/skills', project: '.agents/skills' },
  },
  {
    id: 'grok', name: 'Grok Build', tier: 'C', bin: 'grok', config: '.grok',
    skills: { user: '.grok/skills', project: '.grok/skills' },
  },
  {
    id: 'amp', name: 'Amp', tier: 'C', config: '.config/agents',
    skills: { user: '.config/agents/skills', project: '.agents/skills' },
  },
  {
    id: 'opencode', name: 'OpenCode', tier: 'C', config: '.config/opencode',
    skills: { user: '.config/opencode/skills', project: '.agents/skills' },
  },
  {
    id: 'windsurf', name: 'Windsurf', tier: 'C', config: '.codeium/windsurf',
    skills: { user: '.codeium/windsurf/skills', project: '.windsurf/skills' },
  },
]);

export const TIER_TEXT = {
  A: 'safety checks on',
  B: 'safety checks on once you trust the hooks',
  C: 'skills only',
};

export function hostById(id) {
  const host = HOSTS.find((h) => h.id === id);
  if (!host) throw new Error(`unknown agent "${id}". Known: ${HOSTS.map((h) => h.id).join(', ')}`);
  return host;
}

export function hasAdapter(host) {
  return Boolean(host.adapter);
}

export function readsUniversal(host, scope) {
  return host.skills[scope] === UNIVERSAL[scope];
}

export function universalHosts(scope) {
  return HOSTS.filter((h) => readsUniversal(h, scope));
}

export function additionalHosts(scope) {
  return HOSTS.filter((h) => hasAdapter(h) || !readsUniversal(h, scope));
}

function onPath(bin, env) {
  if (!bin) return false;
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        accessSync(join(dir, `${bin}${ext}`), constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

export function detect(host, { home, env }) {
  const configDir = existsSync(join(home, host.config));
  const binary = onPath(host.bin, env);
  return { configDir, binary, present: configDir || binary };
}

export function detectAll(ctx) {
  return Object.fromEntries(HOSTS.map((h) => [h.id, detect(h, ctx)]));
}
