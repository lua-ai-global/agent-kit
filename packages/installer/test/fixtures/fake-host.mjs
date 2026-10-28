#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const host = basename(process.argv[1]);
const statePath = join(process.env.HOME, `.fake-${host}.json`);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplaces: {}, plugins: {} };
const args = process.argv.slice(2);
const save = () => writeFileSync(statePath, JSON.stringify(state));
const names = { claude: 'claude-code-lua-plugin', codex: 'lua-ai-marketplace' };

const handlers = {
  'plugin marketplace list': () => {
    const list = Object.entries(state.marketplaces).map(([name, source]) => ({ name, path: source, root: source, marketplaceSource: { source } }));
    process.stdout.write(JSON.stringify(host === 'codex' ? { marketplaces: list } : list));
  },
  'plugin marketplace add': () => { state.marketplaces[names[host]] = args[3]; save(); },
  'plugin marketplace remove': () => { delete state.marketplaces[args[3]]; save(); },
  'plugin install': () => { state.plugins[args[2]] = true; save(); },
  'plugin add': () => {
    const source = state.marketplaces[names.codex];
    const { version } = JSON.parse(readFileSync(join(source, '.codex-plugin', 'plugin.json'), 'utf8'));
    cpSync(source, join(process.env.HOME, '.codex', 'plugins', 'cache', names.codex, 'lua-agent-builder', version), { recursive: true });
    state.plugins[args[2]] = true;
    save();
  },
  'plugin uninstall': () => { delete state.plugins[args[2]]; save(); },
  'plugin remove': () => { delete state.plugins[args[2]]; save(); },
};

if (args[0] === '--version') process.exit(0);
const key = Object.keys(handlers).find((k) => args.join(' ').startsWith(k));
if (!key) {
  process.stderr.write(`fake ${host}: unsupported ${args.join(' ')}\n`);
  process.exit(2);
}
handlers[key]();
