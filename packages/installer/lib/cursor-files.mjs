import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { exists } from './fsops.mjs';
import { sourceFor } from './native.mjs';

const FILES = [
  { template: 'cursor-hooks.json', target: 'hooks.json', role: 'hooks' },
  { template: 'cursor-mcp.json', target: 'mcp.json', role: 'mcp' },
];

export const CURSOR_NEXT = 'Cursor: restart it to load Lua.';

function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

function cursorDir(ctx) {
  return ctx.scope === 'project' ? join(ctx.cwd, '.cursor') : join(ctx.home, '.cursor');
}

function render(templateDir, file, root) {
  return readFileSync(join(templateDir, file.template), 'utf8').split('{{PLUGIN_ROOT}}').join(root);
}

function classify(path, content, state) {
  if (!exists(path)) return { op: 'create' };
  const current = readFileSync(path, 'utf8');
  if (current === content) return { op: 'match' };
  const recorded = state.entries.find((e) => e.kind === 'file' && e.path === path);
  if (recorded && recorded.digest === sha(current)) return { op: 'rewrite' };
  return { op: 'skip', reason: 'an existing file this kit did not write; merge the rendered one yourself' };
}

export function planCursorFiles(ctx, state, version = ctx.payload.version) {
  const root = sourceFor({ tree: 'cursor' }, ctx.hub.version(version));
  const templateDir = join(ctx.payload.dir, 'cursor');
  return FILES.map((file) => {
    const path = join(cursorDir(ctx), file.target);
    const content = render(templateDir, file, root);
    return { agent: 'cursor', role: file.role, path, content, source: root, ...classify(path, content, state) };
  });
}

export function applyCursorFile(plan, install, renderedDir) {
  if (plan.op === 'skip') {
    const copy = join(renderedDir, `rendered-${plan.role}.json`);
    writeFileSync(copy, plan.content);
    return { entry: null, line: `cursor: ${plan.path} exists and is yours; merge ${copy} into it to arm the hooks` };
  }
  if (plan.op !== 'match') {
    mkdirSync(dirname(plan.path), { recursive: true });
    writeFileSync(plan.path, plan.content);
  }
  const entry = { install, agent: 'cursor', kind: 'file', role: plan.role, path: plan.path, source: plan.source, digest: sha(plan.content), status: 'ok' };
  return { entry, line: `cursor: ${plan.op === 'match' ? 'already matches' : 'wrote'} ${plan.path}` };
}

export function fileDigest(path) {
  return exists(path) ? sha(readFileSync(path, 'utf8')) : null;
}
