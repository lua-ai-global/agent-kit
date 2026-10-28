import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists } from './fsops.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

export function packageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
}

export function loadPayload(dir = process.env.LUA_AGENT_KIT_PAYLOAD ?? join(PACKAGE_ROOT, 'payload')) {
  const manifestPath = join(dir, 'manifest.json');
  if (!exists(manifestPath)) {
    throw new Error(`no payload at ${dir}. Run \`npm run build:payload\` in packages/installer, or install the published package.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return { dir, version: manifest.version, manifest };
}

export function skillNames(root) {
  const dir = join(root, 'skills');
  if (!exists(dir)) return [];
  return readdirSync(dir).filter((n) => exists(join(dir, n, 'SKILL.md'))).sort();
}
