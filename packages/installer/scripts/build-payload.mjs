#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const DOTFILE_SUFFIX = '.agent-kit-dotfile';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const KIT_ROOT = join(PACKAGE_ROOT, '..', '..');
const TREES = [
  { from: 'dist/claude-code', to: 'claude-code' },
  { from: 'dist/codex', to: 'codex' },
  { from: 'dist/cursor', to: 'cursor', optional: true },
  { from: 'dist/universal/skills', to: 'skills' },
];

const version = JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8')).version;
const pkgVersion = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
if (version !== pkgVersion) {
  process.stderr.write(`build-payload: kit version ${version} != installer version ${pkgVersion}\n`);
  process.exit(1);
}

const out = join(PACKAGE_ROOT, 'payload');
rmSync(out, { recursive: true, force: true });
const trees = [];
for (const tree of TREES) {
  const src = join(KIT_ROOT, tree.from);
  if (!existsSync(src)) {
    if (tree.optional) continue;
    process.stderr.write(`build-payload: ${tree.from} is missing; run node build/emit.mjs --all first\n`);
    process.exit(1);
  }
  cpSync(src, join(out, tree.to), { recursive: true });
  trees.push(tree.to);
}
const NPM_DROPS = ['.gitignore', '.npmrc'];
let renamed = 0;
for (const rel of readdirSync(out, { recursive: true }).map(String)) {
  const name = basename(rel);
  if (!NPM_DROPS.includes(name)) continue;
  renameSync(join(out, rel), join(out, dirname(rel), `${name.slice(1)}${DOTFILE_SUFFIX}`));
  renamed += 1;
}
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({ version, trees, dotfileSuffix: DOTFILE_SUFFIX }, null, 2)}\n`);
process.stdout.write(`build-payload: ${renamed} dotfile(s) npm would drop are stored as <name>${DOTFILE_SUFFIX}\n`);
process.stdout.write(`build-payload: ${version} with ${trees.join(', ')}\n`);
