#!/usr/bin/env node
import { run } from '../lib/cli.mjs';

const io = {
  env: process.env,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  prompts: () => import('@clack/prompts'),
};

run(process.argv.slice(2), io)
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    process.stderr.write(`agent-kit: ${err.message}\n`);
    process.exitCode = 1;
  });
