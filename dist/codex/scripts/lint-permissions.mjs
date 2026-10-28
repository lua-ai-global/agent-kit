#!/usr/bin/env node
// Validates the canonical permissions template at lib/permissions-template.json.
//
// The template is not a plugin default: a plugin-level settings.json
// `permissions` block is silently ignored by the host (iter-12 audit), so
// /lua-doctor offers to merge this file into the user's project
// `.claude/settings.json` on first run. That makes it a shipped security
// artifact — whatever is in `allow` here runs without asking the user.
//
// The check this script exists for: NO CREDENTIAL COMMAND MAY EVER BE
// REACHABLE WITHOUT A PROMPT. `lua auth key` prints the raw API key to
// stdout, and `lua auth configure` collects an email and a one-time code; in
// a model-run flow either one lands in the conversation transcript and stays
// there. Both must be denied, under every name the CLI answers to.
//
// lua-cli's package.json maps `lua`, `heylua` and `lua-ai` to the same
// program, so a rule written only for `lua` is a hole, not a rule. That is
// how `heylua auth key` stayed reachable: it matched no deny rule in this
// template and no regex in hooks/before-shell-execution.mjs.
//
// Precedence is deny → ask → allow, so a deny match is the guarantee that
// survives any future allow rule. This script requires exactly that, and
// additionally refuses to let a credential verb be spelled into `allow` or
// `ask` at all.

import { readFile } from 'node:fs/promises';

const TEMPLATE_PATH = 'lib/permissions-template.json';

// Every name lua-cli installs itself as (its package.json `bin` block).
const LUA_BINARIES = ['lua', 'heylua', 'lua-ai'];
// The plugin only ever emits `lua`; the alternatives exist solely as a way
// around a rule, so they are denied wholesale.
const ALTERNATIVE_BINARIES = LUA_BINARIES.filter((bin) => bin !== 'lua');

const CREDENTIAL_VERBS = [
  { verb: 'auth key', reason: 'prints the raw API key to stdout' },
  { verb: 'auth configure', reason: 'collects account details and a one-time code' },
  { verb: 'auth logout', reason: 'discards the credential the project is authenticated with' },
];

// Concrete command lines, not globs: a rule either matches these or it does not.
const CREDENTIAL_SAMPLES = LUA_BINARIES.flatMap((bin) => [
  { command: `${bin} auth key`, verb: 'auth key' },
  { command: `${bin} auth key --force`, verb: 'auth key' },
  { command: `${bin} auth configure`, verb: 'auth configure' },
  { command: `${bin} auth configure --api-key SECRET --ci`, verb: 'auth configure' },
  { command: `${bin} auth configure --email user@example.com --otp 123456`, verb: 'auth configure' },
  { command: `${bin} auth logout`, verb: 'auth logout' },
]);

const AUTO_DEPLOY_SAMPLES = LUA_BINARIES.flatMap((bin) => [
  `${bin} push all --ci --force --auto-deploy`,
  `${bin} push skill --auto-deploy=true`,
]);

let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

let templateDoc;
try {
  templateDoc = JSON.parse(await readFile(TEMPLATE_PATH, 'utf8'));
} catch (err) {
  console.error(`✗ Could not read ${TEMPLATE_PATH}: ${err.message}`);
  process.exit(1);
}

const perms = templateDoc?.permissions;
if (!perms || typeof perms !== 'object') {
  console.error(`✗ ${TEMPLATE_PATH} must have a "permissions" object`);
  process.exit(1);
}

for (const tier of ['allow', 'ask', 'deny']) {
  if (perms[tier] !== undefined && !Array.isArray(perms[tier])) {
    fail(`permissions.${tier} must be an array`);
  }
}
if (failed) process.exit(1);

for (const tier of ['allow', 'ask', 'deny']) {
  for (const pattern of perms[tier] ?? []) {
    if (typeof pattern !== 'string') {
      fail(`permissions.${tier} entry is not a string: ${JSON.stringify(pattern)}`);
      continue;
    }
    const isBash = pattern.startsWith('Bash(') && pattern.endsWith(')');
    // `mcp__<server>` (every tool of a server) or `mcp__<server>__<tool>`.
    const isMcp = /^mcp__[A-Za-z0-9][A-Za-z0-9_-]*(?:__[a-z][a-z0-9_-]*)?$/.test(pattern);
    if (!isBash && !isMcp) {
      fail(`permissions.${tier} entry is neither Bash(...) nor mcp__<server>[__<tool>]: ${pattern}`);
    }
    if (isMcp && tier !== 'allow') {
      fail(`permissions.${tier} entry ${pattern}: MCP rules belong in allow only (the plugin's MCP tools are read-only; nothing to deny or ask).`);
    }
  }
}

const allowSet = new Set(perms.allow ?? []);
const askSet = new Set(perms.ask ?? []);
const denySet = new Set(perms.deny ?? []);

for (const rule of allowSet) {
  if (askSet.has(rule)) fail(`Pattern in both allow and ask: ${rule}`);
  if (denySet.has(rule)) fail(`Pattern in both allow and deny: ${rule}`);
}
for (const rule of askSet) {
  if (denySet.has(rule)) fail(`Pattern in both ask and deny: ${rule}`);
}

/** Turn a `Bash(<glob>)` rule into the regex the host matches it as. `*` matches anything, spaces included. */
const globToRegex = (rule) => {
  const m = rule.match(/^Bash\((.*)\)$/s);
  if (!m) return null;
  const body = m[1].split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`, 's');
};

const matchingRules = (rules, command) =>
  [...rules].filter((rule) => globToRegex(rule)?.test(command));

// ---------------------------------------------------------------------------
// 1. Every credential command must be denied, under every binary name.
// ---------------------------------------------------------------------------
for (const { command, verb } of CREDENTIAL_SAMPLES) {
  const reason = CREDENTIAL_VERBS.find((entry) => entry.verb === verb)?.reason ?? 'handles a credential';
  if (matchingRules(denySet, command).length === 0) {
    fail(`No deny rule matches "${command}" — \`${verb}\` ${reason}, so in a model-run flow it would land in the conversation transcript. lua-cli installs itself as ${LUA_BINARIES.map((b) => `\`${b}\``).join(', ')} (its package.json \`bin\` block), so each name needs covering; \`Bash(${command.split(' ')[0]} *)\` or a per-verb deny row does it.`);
  }
}

// ---------------------------------------------------------------------------
// 2. A credential verb may not be spelled into allow or ask at all. Deny wins
//    on precedence, but a rule that reads as if credentials were permitted is
//    how the next maintainer talks themselves into widening it.
// ---------------------------------------------------------------------------
for (const [tier, rules] of [['allow', allowSet], ['ask', askSet]]) {
  for (const rule of rules) {
    for (const { verb, reason } of CREDENTIAL_VERBS) {
      if (rule.includes(verb)) {
        fail(`permissions.${tier} rule "${rule}" names a credential command (\`${verb}\` ${reason}). Credentials belong in deny only — the user runs them in their own terminal.`);
      }
    }
    for (const flag of ['--api-key', '--otp']) {
      if (rule.includes(flag)) {
        fail(`permissions.${tier} rule "${rule}" names \`${flag}\` — a credential passed on a command line is a credential in the transcript. There is no safe allow/ask form of this.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The alternative binary names are denied wholesale.
// ---------------------------------------------------------------------------
for (const bin of ALTERNATIVE_BINARIES) {
  const probe = `${bin} compile --ci`;
  if (matchingRules(denySet, probe).length === 0) {
    fail(`permissions.deny must contain \`Bash(${bin} *)\` — \`${bin}\` is the same program as \`lua\` (lua-cli's package.json \`bin\` block), the plugin never emits it, and every per-verb rule written for \`lua\` misses it.`);
  }
}

// ---------------------------------------------------------------------------
// 4. --auto-deploy stays denied: it ships to production without the §3.3
//    confirmation. hooks/block-auto-deploy.mjs is the other line of defence.
// ---------------------------------------------------------------------------
for (const command of AUTO_DEPLOY_SAMPLES) {
  if (matchingRules(denySet, command).length === 0) {
    fail(`No deny rule matches "${command}" — \`--auto-deploy\` bypasses the §3.3 deploy confirmation.`);
  }
}
for (const [tier, rules] of [['allow', allowSet], ['ask', askSet]]) {
  for (const rule of rules) {
    if (rule.includes('--auto-deploy')) {
      fail(`permissions.${tier} rule "${rule}" names \`--auto-deploy\`, which must only ever appear in deny.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. The production gate. A bare production verb must appear in NEITHER deny
//    NOR ask, because a rule in either tier matches past a leading env
//    assignment and would therefore also block the confirmed
//    `LUA_DEPLOY_CONFIRMED=1 …` form — making every deploy impossible. This
//    template used to carry `Bash(lua deploy*)` in deny, which did exactly
//    that. What stops a bare verb is hooks/confirm-deploy.mjs, whose block
//    beats any allow rule; the allow tier therefore has to carry the literal
//    prefixed forms, or a confirmed deploy prompts a second time (and in a
//    non-interactive session, a prompt is a refusal).
// ---------------------------------------------------------------------------
const { PRODUCTION_COMMANDS } = await import('../lib/tokenizer.mjs');
const BARE_SAMPLES = [
  'lua deploy skill --ci --name x --set-version latest --force',
  'lua skills deploy --skill-name x --skill-version latest',
  'lua skills production deploy --skill-name x',
  'lua webhooks deploy --webhook-name x',
  'lua jobs deploy -i x -v latest',
  'lua preprocessors deploy --preprocessor-name x',
  'lua postprocessors deploy --postprocessor-name x',
  'lua persona production deploy --persona-version latest --force',
  'lua workflows deploy outreach -v latest',
  'lua workflows activate outreach',
  'lua version promote 3',
  'lua mcp activate fs',
  'lua marketplace template publish --template-id t',
  'lua marketplace template apply --template-id t --all-installed --force',
];
for (const sample of BARE_SAMPLES) {
  if (!PRODUCTION_COMMANDS.some((entry) => entry.re.test(sample))) {
    fail(`lint self-check: lib/tokenizer.mjs no longer classifies "${sample}" as production. Update this list or the tokenizer — whichever is wrong.`);
  }
  for (const [tier, rules] of [['deny', denySet], ['ask', askSet]]) {
    for (const rule of rules) {
      if (globToRegex(rule)?.test(sample)) {
        fail(`permissions.${tier} rule "${rule}" matches the bare production verb "${sample}". A deny or ask rule is evaluated past a leading env assignment, so it would ALSO block \`LUA_DEPLOY_CONFIRMED=1 ${sample}\` and no deploy could ever run. Remove it — hooks/confirm-deploy.mjs is the gate for bare verbs.`);
      }
    }
  }
  const prefixed = `LUA_DEPLOY_CONFIRMED=1 ${sample}`;
  if (!matchingRules(allowSet, prefixed).length) {
    fail(`No allow rule matches the confirmed form "${prefixed}" — the deploy flow would prompt a second time, and a non-interactive session would refuse it.`);
  }
  if (matchingRules(allowSet, sample).length) {
    fail(`An allow rule admits the BARE production verb "${sample}" — only the LUA_DEPLOY_CONFIRMED=1 form may be allowed.`);
  }
}

// ---------------------------------------------------------------------------
// 6. MCP. The plugin's read-only tools have to be pre-approved or every call
//    to them prompts. A REMOTE server is never allowed as a whole: its host
//    can add a tool at any time and a whole-server rule would pre-approve it
//    unseen, so its tools are listed one by one.
// ---------------------------------------------------------------------------
const PLUGIN_NAME = 'lua-agent-builder';
const REQUIRED_MCP = [
  `mcp__plugin_${PLUGIN_NAME}_lua-platform`,
  'mcp__lua-platform',
];
for (const required of REQUIRED_MCP) {
  if (!allowSet.has(required)) {
    fail(`permissions.allow must contain "${required}" — all five lua-platform tools are read-only, and without this every call to one prompts.`);
  }
}
try {
  const mcpServers = JSON.parse(await readFile('.mcp.json', 'utf8'))?.mcpServers ?? {};
  for (const [server, entry] of Object.entries(mcpServers)) {
    if (entry?.type !== 'http' && entry?.type !== 'sse') continue;
    for (const prefix of [`mcp__plugin_${PLUGIN_NAME}_${server}`, `mcp__${server}`]) {
      for (const rule of allowSet) {
        if (rule === prefix || rule === `${prefix}__*` || rule === `${prefix}*`) {
          fail(`permissions.allow must not allow the whole remote MCP server "${server}" ("${rule}") — its host can add tools at any time. List its tools one by one instead.`);
        }
      }
    }
  }
} catch (err) {
  fail(`Could not read .mcp.json to check remote-server allow rules: ${err.message}`);
}

// ---------------------------------------------------------------------------
// 7. Coverage. Every command a skill actually emits must match an allow rule,
//    or that skill asks the user on every single invocation.
// ---------------------------------------------------------------------------
const REQUIRED_ALLOW_PREFIXES = [
  'Bash(lua --version',
  'Bash(lua init --ci',
  'Bash(lua compile --ci',
  'Bash(lua test --ci',
  'Bash(lua sync --check',
  'Bash(lua chat --ci',
  'Bash(lua logs --ci',
  'Bash(lua push * --ci',
  'Bash(lua status --json',
  // The auth preflight every skill runs. It is `lua models list`, not
  // `lua auth key` (which would print the key into the conversation) and not
  // `lua agents` (which walks every organisation and can take 20 s or more).
  'Bash(lua models list',
  'Bash(lua agents',
  // Read-only git probes the deploy pilot and lua-debug run mid-sequence.
  'Bash(git status',
  'Bash(git log',
  'Bash(git diff',
];
for (const prefix of REQUIRED_ALLOW_PREFIXES) {
  if (![...allowSet].some((rule) => rule.startsWith(prefix))) {
    fail(`Required allow pattern missing: no entry starts with "${prefix}". A skill relies on it, so without it every invocation triggers a permission prompt and breaks §3.7.`);
  }
}

if (failed) {
  console.error('\nFix the issues above and re-run `npm run lint`.');
  process.exit(1);
}
console.log(`✓ permissions template: ${allowSet.size} allow / ${askSet.size} ask / ${denySet.size} deny rules; ${CREDENTIAL_SAMPLES.length} credential and ${AUTO_DEPLOY_SAMPLES.length} --auto-deploy shapes denied; ${BARE_SAMPLES.length} production verbs gated by the hook with their confirmed form allowed.`);
