import { doctor } from './commands/doctor.mjs';
import { install } from './commands/install.mjs';
import { uninstall } from './commands/uninstall.mjs';
import { update } from './commands/update.mjs';
import { packageVersion } from './payload.mjs';

const COMMANDS = { install, update, uninstall, doctor };

const USAGE = `Lua Agent Builder installer

Usage:
  npx lua-agent-kit install   [--agent <id>...] [--global|--project] [--copy] [--dry-run] [--yes] [--skills-only]
  npx lua-agent-kit update    [--agent <id>...] [--to <version>]
  npx lua-agent-kit uninstall [--agent <id>...] [--purge-data]
  npx lua-agent-kit doctor    [--json]

Agents: claude-code, codex, cursor, gemini, copilot, grok, amp, opencode, windsurf ('*' for all).
Nothing is sent anywhere: the installer has no telemetry and never reads a credential.`;

const FLAGS = {
  '--agent': (o, v) => { o.agents.push(v); return 1; },
  '-a': (o, v) => { o.agents.push(v); return 1; },
  '--to': (o, v) => { o.to = v; return 1; },
  '--global': (o) => { o.project = false; return 0; },
  '-g': (o) => { o.project = false; return 0; },
  '--project': (o) => { o.project = true; return 0; },
  '--copy': (o) => { o.copy = true; return 0; },
  '--dry-run': (o) => { o.dryRun = true; return 0; },
  '--yes': (o) => { o.yes = true; return 0; },
  '-y': (o) => { o.yes = true; return 0; },
  '--skills-only': (o) => { o.skillsOnly = true; return 0; },
  '--purge-data': (o) => { o.purgeData = true; return 0; },
  '--json': (o) => { o.json = true; return 0; },
};

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, agents: [], project: false };
  for (let i = 0; i < rest.length; i += 1) {
    const [flag, inline] = rest[i].split(/=(.*)/s);
    const handler = FLAGS[flag];
    if (!handler) throw new Error(`unknown option ${rest[i]}`);
    const value = inline ?? rest[i + 1];
    const used = handler(opts, value);
    if (used && value === undefined) throw new Error(`${flag} needs a value`);
    if (inline === undefined) i += used;
  }
  return opts;
}

export async function run(argv, io) {
  if (['-h', '--help', 'help'].includes(argv[0])) {
    io.out(USAGE);
    return 0;
  }
  if (['-v', '--version'].includes(argv[0])) {
    io.out(packageVersion());
    return 0;
  }
  if (!argv.length || argv[0].startsWith('-')) argv = ['install', ...argv];
  const opts = parseArgs(argv);
  const command = COMMANDS[opts.command];
  if (!command) {
    io.err(`unknown command "${opts.command}"\n\n${USAGE}`);
    return 2;
  }
  return command(opts, io);
}
