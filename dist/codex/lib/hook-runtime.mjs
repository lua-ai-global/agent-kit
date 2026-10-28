import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isHeadless } from './headless.mjs';
import { normaliseInput, render, resolveHost } from './host.mjs';
import { DEFAULT_HOST } from './host-default.mjs';

const REQUIRED_NODE_MAJOR = 18;

export const log = {
  toClaudeCode(message) {
    process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
  },
};

export function exit(code) {
  process.stderr.write('', () => process.exit(code));
}

export function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < REQUIRED_NODE_MAJOR) {
    log.toClaudeCode(
      `LUA_NODE_VERSION_TOO_OLD: This plugin requires Node ≥${REQUIRED_NODE_MAJOR}. ` +
      `You have ${process.versions.node}. ` +
      (isHeadless() ? 'The plugin hooks are inactive in this run.' : 'Update Node and re-run /lua-doctor.')
    );
    exit(0);
  }
}

export function isCursorRuntime(input) {
  return resolveHost(process.env, input, DEFAULT_HOST) === 'cursor';
}

async function readRawStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function readStdin() {
  return normaliseInput(await readRawStdin());
}

export function emitContext(hookEventName, additionalContext) {
  write(render(resolveHost(process.env, null, DEFAULT_HOST), { warn: additionalContext }, { eventName: hookEventName }));
}

function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function isMainScript(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return canonical(fileURLToPath(importMetaUrl)) === canonical(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

function write(output) {
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr) process.stderr.write(output.stderr);
}

export async function runHook(hookName, decideFn, { eventName } = {}) {
  try {
    const raw = await readRawStdin();
    const host = resolveHost(process.env, raw, DEFAULT_HOST);
    const input = normaliseInput(raw);
    const output = render(host, await decideFn(input), { hookName, eventName, input });
    write(output);
    exit(output.code);
  } catch (err) {
    log.toClaudeCode(`Hook ${hookName} error: ${err.message}. Allowing the tool call (fail-open).`);
    exit(0);
  }
}
