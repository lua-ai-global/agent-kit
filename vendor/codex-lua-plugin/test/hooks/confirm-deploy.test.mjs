import { decide } from '../../hooks/confirm-deploy.mjs';

describe('confirm-deploy decide()', () => {
  test('allows env-var-prefixed deploy', () => {
    const result = decide({
      tool_input: { command: 'LUA_DEPLOY_CONFIRMED=1 lua deploy skill --ci --name foo --set-version 1.2.3 --force' }
    });
    expect(result).toBeNull();
  });

  test('allows env-form prefix', () => {
    const result = decide({
      tool_input: { command: 'env LUA_DEPLOY_CONFIRMED=1 lua deploy webhook' }
    });
    expect(result).toBeNull();
  });

  test('allows leading-whitespace prefix', () => {
    const result = decide({
      tool_input: { command: '   LUA_DEPLOY_CONFIRMED=1 lua deploy job' }
    });
    expect(result).toBeNull();
  });

  test('blocks bare lua deploy', () => {
    const result = decide({
      tool_input: { command: 'lua deploy skill --ci --force' }
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('DEPLOY_DENIED_BARE'),
    });
    expect(result.reason).toContain('Use /lua-deploy');
  });

  test('blocks bash-wrapper invocation even with prefix', () => {
    const result = decide({
      tool_input: { command: 'bash -c "LUA_DEPLOY_CONFIRMED=1 lua deploy"' }
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('DEPLOY_DENIED_BARE'),
    });
  });

  test('blocks pipe even with prefix', () => {
    const result = decide({
      tool_input: { command: 'echo y | LUA_DEPLOY_CONFIRMED=1 lua deploy' }
    });
    expect(result?.block).toBe(true);
  });

  test('blocks --auto-deploy in deploy form', () => {
    const result = decide({
      tool_input: { command: 'LUA_DEPLOY_CONFIRMED=1 lua deploy --auto-deploy' }
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('DEPLOY_DENIED_AUTO'),
    });
  });

  test('blocks --auto-deploy in push form too', () => {
    // block-auto-deploy.mjs also catches this. Both hooks refuse it on
    // purpose: a granular `lua push … --auto-deploy` publishes as a side
    // effect of the push, and either hook alone being registered, reordered
    // or filtered away would leave the only gate on a production change to
    // chance.
    const result = decide({ tool_input: { command: 'lua push all --auto-deploy' } });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('DEPLOY_DENIED_AUTO');
  });

  // After the Cursor-port fix (2026-05-03), the hook early-returns null
  // for any command that isn't a `lua deploy` variant. The previous
  // "missing input → block" behavior depended on the host's matcher to
  // ensure decide() only ran for `lua deploy` commands; under Cursor that
  // assumption broke and blocked every shell command including
  // `node --version`. The hook now self-filters.

  test('allows when input is null (host invoked us with no payload)', () => {
    expect(decide(null)).toBeNull();
  });

  test('allows when tool_input is missing', () => {
    expect(decide({})).toBeNull();
  });

  test('allows when command field is missing', () => {
    expect(decide({ tool_input: {} })).toBeNull();
  });

  test('allows when command is empty string', () => {
    expect(decide({ tool_input: { command: '' } })).toBeNull();
  });

  // Regression tests for the Cursor-port bug — every shell command was
  // being blocked with DEPLOY_DENIED_BARE because the matcher in
  // hooks.json wasn't filtering as expected. The hook must now safely
  // no-op for any non-deploy command.

  describe('Cursor-port regression — non-deploy commands must be allowed', () => {
    const allowedCommands = [
      'node --version',
      'npm --version',
      'lua --version',
      'lua compile --ci',
      'lua test --ci',
      'lua chat --ci -m "hello" -t test',
      'ls -la',
      'pwd',
      'git status',
    ];
    test.each(allowedCommands)('allows: %s', (command) => {
      expect(decide({ tool_input: { command } })).toBeNull();
    });

    // The classifier reads the command rather than substring-matching it, so
    // text that merely mentions a verb is no longer a false positive.
    test.each([
      'git commit -m "lua deploy all"',
      'echo "Next: lua deploy all"',
      'grep -rn "lua deploy" docs/',
      'lua test --ci skill --name deploy',
      'lua workflows deactivate outreach',
      'lua version create -m "before deploy"',
    ])('allows text that only mentions a verb: %s', (command) => {
      expect(decide({ tool_input: { command } })).toBeNull();
    });
  });

  // Until the classifier landed, this hook tested `/\blua\s+deploy\b/` and
  // returned null for anything else, so every production verb other than
  // `lua deploy` reached the server unchallenged. `lua version promote` is
  // the sharpest of them: it swaps the live agent version atomically and
  // asks nothing of its own.
  describe('every production verb is gated, not just `lua deploy`', () => {
    test.each([
      ['lua version promote 3', 'lua version promote'],
      ['lua skills deploy --skill-name x --skill-version latest', 'lua skills deploy'],
      ['lua skills production deploy --skill-name x', 'lua skills production deploy'],
      ['lua webhooks deploy --webhook-name x', 'lua webhooks deploy'],
      ['lua jobs deploy -i x -v latest', 'lua jobs deploy'],
      ['lua preprocessors deploy --preprocessor-name x', 'lua preprocessors deploy'],
      ['lua postprocessors deploy --postprocessor-name x', 'lua postprocessors deploy'],
      ['lua persona production deploy --persona-version 5', 'lua persona production deploy'],
      ['lua workflows deploy outreach -v latest', 'lua workflows deploy'],
      ['lua workflows activate outreach', 'lua workflows activate'],
      ['lua mcp activate fs', 'lua mcp activate'],
      ['lua marketplace template publish --template-id t', 'lua marketplace template publish'],
      ['lua marketplace template apply --template-id t --all-installed --force', 'lua marketplace template apply'],
    ])('blocks bare `%s`', (command, label) => {
      const result = decide({ tool_input: { command } });
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain('DEPLOY_DENIED_BARE');
      expect(result?.reason).toContain(label);
    });

    test.each([
      'LUA_DEPLOY_CONFIRMED=1 lua version promote 3',
      'LUA_DEPLOY_CONFIRMED=1 lua mcp activate fs',
      'env LUA_DEPLOY_CONFIRMED=1 lua workflows deploy outreach -v 2',
      'cd agent && LUA_DEPLOY_CONFIRMED=1 lua deploy all --ci --force',
    ])('allows the confirmed form: %s', (command) => {
      expect(decide({ tool_input: { command } })).toBeNull();
    });

    // lua-cli installs the same program as `lua`, `heylua` and `lua-ai`, and
    // resolves action aliases at runtime, so the gate has to match all of them.
    test.each([
      'heylua version promote 3',
      'lua-ai mcp on fs',
      'lua workflows publish outreach -v 2',
      'lua marketplace templates rollout --template-id t',
      'lua persona live publish --persona-version 5',
    ])('blocks an alias spelling: %s', (command) => {
      expect(decide({ tool_input: { command } })?.block).toBe(true);
    });

    // The old regex was anchored at the start of the string.
    test.each([
      'cd x && lua deploy all',
      'true; lua version promote 3',
      'FOO=1 lua deploy all',
      '/usr/local/bin/lua deploy all',
      'npx lua deploy all',
      'bash -c "lua deploy all"',
      'echo $(lua version promote 3)',
    ])('blocks a verb reached past the head of the command: %s', (command) => {
      expect(decide({ tool_input: { command } })?.block).toBe(true);
    });
  });

  // Headless there is nobody to confirm anything, so the prefix would only
  // ever mean the model confirmed to itself.
  describe('headless (LUA_PLUGIN_HEADLESS=1): the prefix is void', () => {
    const HEADLESS = { LUA_PLUGIN_HEADLESS: '1' };
    const SLASH = /\/lua-[a-z]/;

    test.each([
      'lua deploy all --force',
      'LUA_DEPLOY_CONFIRMED=1 lua deploy skill --ci --name x --set-version latest --force',
      'env LUA_DEPLOY_CONFIRMED=1 lua version promote 3',
      'LUA_DEPLOY_CONFIRMED=1 lua marketplace template apply --template-id t --all-installed --force',
    ])('blocks %s and names no skill to run', (command) => {
      const result = decide({ tool_input: { command } }, HEADLESS);
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain('DEPLOY_DENIED_HEADLESS');
      expect(result?.reason).not.toMatch(SLASH);
    });

    test('--auto-deploy is blocked without a skill pointer', () => {
      const result = decide({ tool_input: { command: 'lua push skill --ci --force --auto-deploy' } }, HEADLESS);
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain('DEPLOY_DENIED_AUTO');
      expect(result?.reason).not.toMatch(SLASH);
    });

    test('non-production commands still pass', () => {
      for (const command of ['lua push all --ci --force', 'lua version create --ci -m "x"', 'lua compile --ci', 'git status']) {
        expect(decide({ tool_input: { command } }, HEADLESS)).toBeNull();
      }
    });

    test('the same prefixed command is allowed interactively', () => {
      expect(decide({ tool_input: { command: 'LUA_DEPLOY_CONFIRMED=1 lua version promote 3' } }, {})).toBeNull();
    });
  });

  test('a command too long or complex to classify is blocked on its own reason', () => {
    const command = `lua status ${'x'.repeat(40 * 1024)}`;
    const result = decide({ tool_input: { command } }, {});
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('DEPLOY_DENIED_UNCLASSIFIABLE');
    expect(decide({ tool_input: { command: `git status ${'x'.repeat(40 * 1024)}` } }, {})).toBeNull();
  });
});
