export const HOSTS = Object.freeze(['claude-code', 'codex', 'cursor']);

const CONTEXT_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
]);

const SHELLS = new Set(['bash', 'sh', 'zsh', '/bin/bash', '/bin/sh', '/bin/zsh', '/usr/bin/bash', '/usr/bin/zsh']);

function isFlatShellInput(input) {
  return Boolean(input && typeof input === 'object' && input.command && !input.tool_input);
}

export function resolveHost(env = process.env, input = null, fallback = 'claude-code') {
  if (HOSTS.includes(env.LUA_AGENT_HOST)) return env.LUA_AGENT_HOST;
  if (env.CURSOR_TRACE_ID || env.CURSOR_PLUGIN_ROOT || isFlatShellInput(input)) return 'cursor';
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDE_PROJECT_DIR) return 'claude-code';
  if (env.PLUGIN_ROOT || env.PLUGIN_DATA) return 'codex';
  return fallback;
}

export function commandString(command) {
  if (typeof command === 'string') return command;
  if (!Array.isArray(command) || command.length === 0) return undefined;
  const [bin, flag, script] = command;
  if (command.length === 3 && SHELLS.has(bin) && (flag === '-c' || flag === '-lc')) return script;
  return command.join(' ');
}

function normaliseToolInput(raw) {
  const command = commandString(raw.tool_input.command);
  if (command === undefined || command === raw.tool_input.command) return raw;
  return { ...raw, tool_input: { ...raw.tool_input, command } };
}

export function normaliseInput(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.tool_input) return normaliseToolInput(raw);
  if (!raw.command) return raw;
  return {
    tool_name: 'Bash',
    tool_input: { command: commandString(raw.command), cwd: raw.cwd },
    cwd: raw.cwd,
    cursor: raw,
  };
}

function line(value) {
  return `${JSON.stringify(value)}\n`;
}

function contextEnvelope(eventName, message) {
  if (!CONTEXT_EVENTS.has(eventName)) return { stderr: `⚠ ${message}\n`, code: 0 };
  return { stdout: line({ hookSpecificOutput: { hookEventName: eventName, additionalContext: message } }), code: 0 };
}

function preToolUseDecision(permissionDecision, reason, extra = {}) {
  return line({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason, ...extra },
  });
}

function terminal(message) {
  return message.endsWith('\n') ? message : `${message}\n`;
}

const claudeCode = {
  block: (reason) => ({ stderr: terminal(reason), code: 2 }),
  allow: (reason) => ({ stdout: preToolUseDecision('allow', reason), code: 0 }),
  ask: (reason) => ({ stdout: preToolUseDecision('ask', reason), code: 0 }),
  context: contextEnvelope,
};

export const ASK_UNSUPPORTED_SUFFIX =
  ' This host cannot ask for confirmation from a hook, so the command was not run. Run it yourself in your own terminal if you want it.';

const codex = {
  block: claudeCode.block,
  allow(reason, input) {
    const command = commandString(input?.tool_input?.command);
    if (typeof command !== 'string') return { code: 0 };
    return { stdout: preToolUseDecision('allow', reason, { updatedInput: { ...input.tool_input, command } }), code: 0 };
  },
  ask: (reason) => claudeCode.block(`${reason}${ASK_UNSUPPORTED_SUFFIX}`),
  context: contextEnvelope,
};

const cursor = {
  block: (reason) => ({ stdout: line({ permission: 'deny', user_message: reason, agent_message: reason }), code: 0 }),
  allow: (reason) => ({ stdout: line({ permission: 'allow', user_message: reason }), code: 0 }),
  ask: (reason) => ({ stdout: line({ permission: 'ask', user_message: reason, agent_message: reason }), code: 0 }),
  context: (_eventName, message) => ({ stdout: line({ permission: 'allow', user_message: message }), code: 0 }),
};

const PROTOCOLS = { 'claude-code': claudeCode, codex, cursor };

export function protocolFor(host) {
  const protocol = PROTOCOLS[host];
  if (!protocol) throw new Error(`unknown host: ${host}`);
  return protocol;
}

const DEFAULT_REASONS = { block: 'Blocked by', ask: 'Confirm', allow: 'Approved by' };

function permissionKind(decision, eventName) {
  if (!decision) return null;
  if (decision.block) return 'block';
  if (eventName !== 'PreToolUse') return null;
  if (decision.ask) return 'ask';
  return decision.allow ? 'allow' : null;
}

function renderWarn(host, protocol, warn, eventName) {
  if (!warn) return { code: 0 };
  if (!eventName && host !== 'cursor') return { stderr: `⚠ ${warn}\n`, code: 0 };
  return protocol.context(eventName, warn);
}

export function render(host, decision, { hookName, eventName, input } = {}) {
  const protocol = protocolFor(host);
  const kind = permissionKind(decision, eventName);
  if (kind) return protocol[kind](decision.reason ?? `${DEFAULT_REASONS[kind]} ${hookName}.`, input);
  return renderWarn(host, protocol, decision?.warn, eventName);
}
