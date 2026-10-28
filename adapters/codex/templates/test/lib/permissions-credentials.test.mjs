import { describe, test, expect, beforeAll } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decide } from '../../hooks/before-shell-execution.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every name lua-cli installs itself as (its package.json `bin` block maps all
// three to the same dist/index.js).
const LUA_BINARIES = ['lua', 'heylua', 'lua-ai'];

const CREDENTIAL_COMMANDS = LUA_BINARIES.flatMap((bin) => [
  `${bin} auth key`,
  `${bin} auth key --force`,
  `${bin} auth configure`,
  `${bin} auth configure --api-key SECRET --ci`,
  `${bin} auth configure --email user@example.com --otp 123456`,
  `${bin} auth logout`,
]);

/** The regex the host matches a `Bash(<glob>)` rule as: `*` matches anything, spaces included. */
const globToRegex = (rule) => {
  const m = rule.match(/^Bash\((.*)\)$/s);
  if (!m) return null;
  const body = m[1].split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`, 's');
};

let permissions;
beforeAll(async () => {
  const raw = await readFile(join(repoRoot, 'lib', 'permissions-template.json'), 'utf8');
  permissions = JSON.parse(raw).permissions;
});

describe('permissions template — credentials never ride an allow rule', () => {
  test.each(CREDENTIAL_COMMANDS)('a deny rule matches `%s`', (command) => {
    const matched = (permissions.deny ?? []).filter((rule) => globToRegex(rule)?.test(command));
    expect(matched.length).toBeGreaterThan(0);
  });

  test('no allow or ask rule names a credential verb or a credential flag', () => {
    const offenders = [];
    for (const tier of ['allow', 'ask']) {
      for (const rule of permissions[tier] ?? []) {
        for (const needle of ['auth key', 'auth configure', 'auth logout', '--api-key', '--otp']) {
          if (rule.includes(needle)) offenders.push(`${tier}: ${rule} (${needle})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the alternative binary names are denied wholesale', () => {
    for (const bin of ['heylua', 'lua-ai']) {
      expect(permissions.deny).toContain(`Bash(${bin} *)`);
    }
  });

  test('--auto-deploy appears only in deny', () => {
    for (const tier of ['allow', 'ask']) {
      for (const rule of permissions[tier] ?? []) {
        expect(rule).not.toContain('--auto-deploy');
      }
    }
    for (const bin of LUA_BINARIES) {
      const command = `${bin} push all --ci --force --auto-deploy`;
      const matched = (permissions.deny ?? []).filter((rule) => globToRegex(rule)?.test(command));
      expect(matched.length).toBeGreaterThan(0);
    }
  });

  test('the sync direction that overwrites local files asks, the guarded one does not', () => {
    expect(permissions.allow).toContain('Bash(lua sync --pull*)');
    expect(permissions.ask).toContain('Bash(lua sync --pull --force*)');
    expect(Object.values(permissions).flat().some((rule) => rule.includes('--accept'))).toBe(false);
  });
});

// The template only applies once /lua-doctor has merged it into the project's
// settings. The hook is what gates an unconfigured project, so the same
// command shapes have to be refused there too.
describe('shell gate and permissions template agree on credentials', () => {
  test.each(CREDENTIAL_COMMANDS)('the shell gate blocks `%s`', (command) => {
    expect(decide({ tool_input: { command } })?.block).toBe(true);
  });
});
