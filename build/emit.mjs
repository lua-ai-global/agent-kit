#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ADAPTERS = ['claude-code'];

function walk(abs, rel, exclude, out) {
  const st = statSync(abs);
  if (!st.isDirectory()) {
    out.push({ abs, rel, mode: st.mode });
    return out;
  }
  for (const entry of readdirSync(abs).sort()) {
    if (exclude.includes(entry)) continue;
    walk(join(abs, entry), rel ? `${rel}/${entry}` : entry, exclude, out);
  }
  return out;
}

export function planMounts(mounts) {
  const plan = new Map();
  for (const mount of mounts) {
    const files = walk(join(ROOT, mount.from), '', mount.exclude ?? [], []);
    for (const file of files) {
      const dest = file.rel ? `${mount.to}/${file.rel}` : mount.to;
      const key = dest.replace(/^\.\//, '');
      if (plan.has(key)) throw new Error(`emit: two sources write ${key}: ${plan.get(key).abs} and ${file.abs}`);
      plan.set(key, file);
    }
  }
  return plan;
}

export async function loadAdapter(name) {
  return import(pathToFileURL(join(ROOT, 'adapters', name, 'adapter.mjs')).href);
}

export async function emit(name, outDir) {
  const adapter = await loadAdapter(name);
  const plan = planMounts(adapter.mounts);
  rmSync(outDir, { recursive: true, force: true });
  for (const [rel, file] of plan) {
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file.abs, dest);
    chmodSync(dest, file.mode & 0o777);
  }
  return plan.size;
}

function parseArgs(argv) {
  const args = { adapters: [], out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--all') args.adapters = [...ADAPTERS];
    else if (argv[i] === '--adapter') args.adapters.push(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
    else throw new Error(`emit: unknown argument ${argv[i]}`);
  }
  if (args.adapters.length === 0) args.adapters = [...ADAPTERS];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const name of args.adapters) {
    const outDir = args.out && args.adapters.length === 1 ? resolve(args.out) : join(ROOT, 'dist', name);
    const count = await emit(name, outDir);
    process.stdout.write(`emit: ${name} -> ${outDir} (${count} files)\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
