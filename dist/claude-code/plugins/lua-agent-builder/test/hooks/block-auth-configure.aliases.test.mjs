import { describe, expect, test } from '@jest/globals';
import { decide } from '../../hooks/block-auth-configure.mjs';
import { LUA_BINARIES } from '../../lib/lua-bin.mjs';
import { classifyProductionCommand } from '../../lib/tokenizer.mjs';

describe('block-auth-configure covers every name lua-cli answers to', () => {
  test.each([
    'heylua auth configure',
    'lua-ai auth configure',
    'npx lua auth configure',
    'npx lua-cli auth configure',
    'npx --yes lua-cli auth configure --email person@example.com',
    'pnpm exec heylua auth configure',
    '/usr/local/bin/lua-ai auth configure',
    './node_modules/.bin/heylua auth configure',
    'LUA.cmd auth configure',
    'cd agent && heylua auth configure',
    "bash -c 'lua-ai auth configure'",
    'echo $(heylua auth configure)',
    'lua   auth   configure',
  ])('blocks %s', (command) => {
    const result = decide({ tool_input: { command } });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('AUTH_INPUT_DENIED');
  });

  test.each([
    'heylua auth configuration',
    'lua-ai auth logout',
    'echo lua-auth configure',
    'mylua auth configure',
    'heyluax auth configure',
  ])('allows %s', (command) => {
    expect(decide({ tool_input: { command } })).toBeNull();
  });

  test('the alias list matches the binaries the deploy classifier recognises', () => {
    for (const bin of LUA_BINARIES.filter((b) => b !== 'lua-cli')) {
      expect(classifyProductionCommand(`${bin} deploy all`)).not.toBeNull();
    }
    expect(classifyProductionCommand('npx lua-cli deploy all')).not.toBeNull();
    expect(classifyProductionCommand('mylua deploy all')).toBeNull();
  });
});
