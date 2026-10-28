import { describe, expect, test } from '@jest/globals';
import { failureOutput } from '../../lib/hook-runtime.mjs';

const boom = new Error('boom');

describe('failureOutput', () => {
  test('a hook not on the fail-closed list fails open on every host', () => {
    for (const host of ['claude-code', 'codex', 'cursor']) {
      const out = failureOutput('warn-version-zero', boom, { host, failClosed: ['confirm-deploy'] });
      expect(out.code).toBe(0);
      expect(out.stdout).toBeUndefined();
      expect(out.stderr).toBe('Hook warn-version-zero error: boom. Allowing the tool call (fail-open).\n');
    }
  });

  test('a fail-closed hook blocks with the host protocol', () => {
    const claude = failureOutput('confirm-deploy', boom, { host: 'claude-code', failClosed: ['confirm-deploy'] });
    expect(claude.code).toBe(2);
    expect(claude.stderr).toMatch(/Hook confirm-deploy error: boom\. Blocking the command.*fail-closed/);
    const cursor = failureOutput('confirm-deploy', boom, { host: 'cursor', failClosed: ['confirm-deploy'] });
    expect(cursor.code).toBe(0);
    expect(JSON.parse(cursor.stdout)).toMatchObject({ permission: 'deny' });
  });

  test('the emitted default list decides when none is passed', () => {
    const out = failureOutput('some-hook', boom, { host: 'claude-code' });
    expect(out.code).toBe(0);
  });
});
