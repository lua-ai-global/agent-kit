import { describe, expect, test } from '@jest/globals';
import {
  ASK_UNSUPPORTED_SUFFIX, HOSTS, commandString, normaliseInput, protocolFor, render, resolveHost,
} from '../../lib/host.mjs';

describe('resolveHost', () => {
  test('an explicit LUA_AGENT_HOST wins', () => {
    expect(resolveHost({ LUA_AGENT_HOST: 'codex', CURSOR_TRACE_ID: 'x' })).toBe('codex');
  });

  test('an unknown LUA_AGENT_HOST is ignored', () => {
    expect(resolveHost({ LUA_AGENT_HOST: 'emacs' }, null, 'codex')).toBe('codex');
  });

  test('Cursor by env or by its flat shell payload', () => {
    expect(resolveHost({ CURSOR_TRACE_ID: 't' })).toBe('cursor');
    expect(resolveHost({ CURSOR_PLUGIN_ROOT: '/p' })).toBe('cursor');
    expect(resolveHost({}, { command: 'ls', cwd: '/' })).toBe('cursor');
  });

  test('Claude Code by its plugin env', () => {
    expect(resolveHost({ CLAUDE_PLUGIN_ROOT: '/p' }, null, 'codex')).toBe('claude-code');
    expect(resolveHost({ CLAUDE_PROJECT_DIR: '/p' }, null, 'codex')).toBe('claude-code');
  });

  test('Codex by its plugin env', () => {
    expect(resolveHost({ PLUGIN_ROOT: '/p' })).toBe('codex');
    expect(resolveHost({ PLUGIN_DATA: '/d' })).toBe('codex');
  });

  test('reads process.env by default', () => {
    expect(HOSTS).toContain(resolveHost());
  });

  test('falls back to the emitted default', () => {
    expect(resolveHost({}, { tool_input: { command: 'ls' } }, 'codex')).toBe('codex');
    expect(resolveHost({})).toBe('claude-code');
  });
});

describe('commandString', () => {
  test('passes strings through', () => {
    expect(commandString('lua deploy all')).toBe('lua deploy all');
  });

  test('unwraps a shell -c / -lc argv', () => {
    expect(commandString(['bash', '-lc', 'lua deploy all'])).toBe('lua deploy all');
    expect(commandString(['/bin/zsh', '-c', 'x && y'])).toBe('x && y');
  });

  test('joins any other argv', () => {
    expect(commandString(['lua', 'deploy', 'all'])).toBe('lua deploy all');
  });

  test('undefined for nothing usable', () => {
    expect(commandString([])).toBeUndefined();
    expect(commandString(42)).toBeUndefined();
  });
});

describe('normaliseInput', () => {
  test('null and non-objects pass through', () => {
    expect(normaliseInput(null)).toBeNull();
    expect(normaliseInput('x')).toBe('x');
  });

  test('a payload without a command passes through', () => {
    const raw = { session_id: 's' };
    expect(normaliseInput(raw)).toBe(raw);
  });

  test('a string tool_input.command is left as is', () => {
    const raw = { tool_input: { command: 'ls' } };
    expect(normaliseInput(raw)).toBe(raw);
  });

  test('a tool_input with no usable command is left as is', () => {
    const raw = { tool_input: { file_path: '/x' } };
    expect(normaliseInput(raw)).toBe(raw);
  });

  test('an argv tool_input.command becomes a string', () => {
    const out = normaliseInput({ tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'lua compile'], workdir: '/w' } });
    expect(out.tool_input).toEqual({ command: 'lua compile', workdir: '/w' });
  });

  test('a flat Cursor payload is wrapped and keeps cwd at both levels', () => {
    const out = normaliseInput({ command: 'lua deploy', cwd: '/w' });
    expect(out).toMatchObject({ tool_name: 'Bash', tool_input: { command: 'lua deploy', cwd: '/w' }, cwd: '/w' });
    expect(out.cursor.command).toBe('lua deploy');
  });
});

describe('render', () => {
  const input = { tool_input: { command: 'lua env production --list' } };

  test('unknown host throws', () => {
    expect(() => protocolFor('emacs')).toThrow('unknown host');
  });

  test('no decision renders nothing', () => {
    for (const host of HOSTS) expect(render(host, null)).toEqual({ code: 0 });
  });

  test('default reasons name the hook', () => {
    expect(render('claude-code', { block: true }, { hookName: 'h' }).stderr).toBe('Blocked by h.\n');
    const allow = JSON.parse(render('claude-code', { allow: true }, { hookName: 'h', eventName: 'PreToolUse' }).stdout);
    expect(allow.hookSpecificOutput.permissionDecisionReason).toBe('Approved by h.');
    const ask = JSON.parse(render('claude-code', { ask: true }, { hookName: 'h', eventName: 'PreToolUse' }).stdout);
    expect(ask.hookSpecificOutput).toMatchObject({ permissionDecision: 'ask', permissionDecisionReason: 'Confirm h.' });
  });

  test('allow and ask only apply on PreToolUse', () => {
    expect(render('claude-code', { allow: true }, { eventName: 'PostToolUse' })).toEqual({ code: 0 });
    expect(render('claude-code', { ask: true }, { eventName: 'PostToolUse' })).toEqual({ code: 0 });
  });

  test('Codex has no ask: it becomes a deny that tells the user to run it themselves', () => {
    const out = render('codex', { ask: true, reason: 'Org-wide change.' }, { eventName: 'PreToolUse', input });
    expect(out.code).toBe(2);
    expect(out.stderr).toBe(`Org-wide change.${ASK_UNSUPPORTED_SUFFIX}\n`);
  });

  test('Codex allow without a command string renders nothing rather than an invalid rewrite', () => {
    expect(render('codex', { allow: true }, { eventName: 'PreToolUse', input: { tool_input: {} } })).toEqual({ code: 0 });
    expect(render('codex', { allow: true }, { eventName: 'PreToolUse' })).toEqual({ code: 0 });
  });

  test('Cursor ask is native', () => {
    const out = JSON.parse(render('cursor', { ask: true, reason: 'r' }, { eventName: 'PreToolUse' }).stdout);
    expect(out).toEqual({ permission: 'ask', user_message: 'r', agent_message: 'r' });
  });

  test('warn without an event falls back to stderr except on Cursor', () => {
    expect(render('claude-code', { warn: 'w' })).toEqual({ stderr: '⚠ w\n', code: 0 });
    expect(render('codex', { warn: 'w' })).toEqual({ stderr: '⚠ w\n', code: 0 });
    expect(JSON.parse(render('cursor', { warn: 'w' }).stdout)).toEqual({ permission: 'allow', user_message: 'w' });
  });

  test('warn on an event with no context envelope falls back to stderr', () => {
    expect(render('claude-code', { warn: 'w' }, { eventName: 'Stop' })).toEqual({ stderr: '⚠ w\n', code: 0 });
  });

  test('a block reason that already ends in a newline is not doubled', () => {
    expect(render('claude-code', { block: true, reason: 'no\n' }).stderr).toBe('no\n');
  });
});
