import { describe, expect, test } from '@jest/globals';
import { HOSTS, normaliseInput, render } from '../../lib/host.mjs';
import { decide as confirmDeploy } from '../../hooks/confirm-deploy.mjs';
import { decide as blockAutoDeploy } from '../../hooks/block-auto-deploy.mjs';
import { decide as blockAuthConfigure } from '../../hooks/block-auth-configure.mjs';
import { decide as blockDeviceSecret } from '../../hooks/block-device-secret.mjs';
import { decide as approveWebApp } from '../../hooks/approve-web-app.mjs';
import { decide as warnVersionZero } from '../../hooks/warn-version-zero.mjs';

const INTERACTIVE = {};

const CASES = [
  { hook: 'confirm-deploy', decide: confirmDeploy, command: 'lua deploy all', expect: 'block' },
  { hook: 'confirm-deploy', decide: confirmDeploy, command: 'cd agent && lua version promote 3', expect: 'block' },
  { hook: 'confirm-deploy', decide: confirmDeploy, command: 'npx lua mcp activate linear', expect: 'block' },
  { hook: 'confirm-deploy', decide: confirmDeploy, command: 'heylua deploy all', expect: 'block' },
  { hook: 'confirm-deploy', decide: confirmDeploy, command: 'LUA_DEPLOY_CONFIRMED=1 lua deploy all', expect: 'none' },
  { hook: 'confirm-deploy', decide: confirmDeploy, command: 'lua compile --ci', expect: 'none' },
  { hook: 'block-auto-deploy', decide: blockAutoDeploy, command: 'lua push skill --name x --auto-deploy', expect: 'block' },
  { hook: 'block-auth-configure', decide: blockAuthConfigure, command: 'lua auth configure', expect: 'block' },
  { hook: 'block-device-secret', decide: blockDeviceSecret, command: 'lua devices credential pump --ci', expect: 'block' },
  { hook: 'approve-web-app', decide: approveWebApp, command: 'lua apps new board', event: 'PreToolUse', expect: 'allow' },
  { hook: 'approve-web-app', decide: approveWebApp, command: 'lua apps new board extra', event: 'PreToolUse', expect: 'none' },
  { hook: 'warn-version-zero', decide: warnVersionZero, command: 'lua push skill --set-version 0.1.0 --ci --force', event: 'PreToolUse', expect: 'warn' },
];

function wireInput(host, command) {
  if (host === 'cursor') return { command, cwd: '/work', conversation_id: 'c1', hook_event_name: 'beforeShellExecution' };
  if (host === 'codex') return { tool_name: 'shell', tool_input: { command: ['bash', '-lc', command] }, cwd: '/work' };
  return { tool_name: 'Bash', tool_input: { command }, cwd: '/work' };
}

function parsed(output) {
  return output.stdout ? JSON.parse(output.stdout) : null;
}

const EXPECTATIONS = {
  'claude-code': {
    block: (o) => { expect(o.code).toBe(2); expect(o.stderr).toMatch(/\S/); expect(o.stdout).toBeUndefined(); },
    allow: (o) => { expect(o.code).toBe(0); expect(parsed(o).hookSpecificOutput.permissionDecision).toBe('allow'); },
    warn: (o) => { expect(o.code).toBe(0); expect(parsed(o).hookSpecificOutput.additionalContext).toMatch(/\S/); },
  },
  codex: {
    block: (o) => { expect(o.code).toBe(2); expect(o.stderr).toMatch(/\S/); expect(o.stdout).toBeUndefined(); },
    allow: (o, command) => {
      const out = parsed(o).hookSpecificOutput;
      expect(out.permissionDecision).toBe('allow');
      expect(out.updatedInput.command).toBe(command);
    },
    warn: (o) => { expect(parsed(o).hookSpecificOutput.additionalContext).toMatch(/\S/); },
  },
  cursor: {
    block: (o) => { expect(o.code).toBe(0); expect(parsed(o)).toMatchObject({ permission: 'deny' }); expect(parsed(o).agent_message).toMatch(/\S/); },
    allow: (o) => { expect(parsed(o)).toMatchObject({ permission: 'allow' }); },
    warn: (o) => { expect(parsed(o)).toMatchObject({ permission: 'ask' }); expect(parsed(o).user_message).toMatch(/\S/); },
  },
};

describe.each(HOSTS)('host profile %s', (host) => {
  test.each(CASES)('$hook: $command -> $expect', ({ hook, decide, command, event, expect: kind }) => {
    const input = normaliseInput(wireInput(host, command));
    expect(input.tool_input.command).toBe(command);
    const output = render(host, decide(input, INTERACTIVE), { hookName: hook, eventName: event, input });
    if (kind === 'none') {
      expect(output).toEqual({ code: 0 });
      return;
    }
    EXPECTATIONS[host][kind](output, command);
  });
});
