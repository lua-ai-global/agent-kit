// Cursor `beforeShellExecution` hook — replaces the static permissions-deny
// rules from the Claude Code plugin's lib/permissions-template.json (Cursor
// has no `permissions.deny` equivalent, so we gate destructive operations
// with a hook).
//
// Coverage:
//   1. `lua auth key*`     — would print API key to stdout (transcript leak)
//   2. `lua auth configure` — account and credential input belongs in a private terminal
//   3. `--auto-deploy`     — bypasses the §3.3 confirmation contract
//   4. bare `lua deploy`   — must be prefixed with LUA_DEPLOY_CONFIRMED=1
//                            (set by confirm-deploy.mjs after the user OKs the
//                             5-step gated ship via /lua-deploy)
//
// Uses runHook from lib/hook-runtime.mjs which handles both Claude Code's
// stderr+exit-2 protocol AND Cursor's structured JSON output via runtime
// detection. The hook itself just exports a pure decide(input) function.
//
// Every rule matches the CLI under all three names it installs itself as.
// lua-cli's package.json `bin` block maps `lua`, `heylua` and `lua-ai` to the
// same dist/index.js, so a rule anchored on `\blua\s+` alone missed
// `heylua auth key` (no word boundary inside "heylua") and `lua-ai auth key`
// (no whitespace after "lua") — both printed the raw API key straight into the
// conversation. LUA_BIN below is the one spelling of "the CLI, however it was
// invoked" that each rule reuses.

import { runHook, checkNodeVersion, isMainScript } from '../lib/hook-runtime.mjs';

// Start of a command word, an optional path prefix (`./node_modules/.bin/lua`,
// `/usr/local/bin/heylua`), then one of the three binary names.
const LUA_BIN = String.raw`(?:^|[\s;&|(])(?:[^\s;&|()]*[/\\])?(?:lua|heylua|lua-ai)\s+`;
const luaCommand = (...verb) => new RegExp(LUA_BIN + verb.join(String.raw`\s+`) + String.raw`\b`);

const AUTH_KEY = luaCommand('auth', 'key');
const AUTH_CONFIGURE = luaCommand('auth', 'configure');
const AUTH_LOGOUT = luaCommand('auth', 'logout');
const DEPLOY = luaCommand('deploy');

/**
 * @param {{tool_input?: {command?: string}}|null} input
 */
export function decide(input) {
  const command = input?.tool_input?.command ?? '';

  // 1. lua auth key — never. The CLI writes the API key to stdout, which would
  // put it in the chat transcript permanently.
  if (AUTH_KEY.test(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_AUTH_KEY: Refused to run `lua auth key*` — the CLI prints your API key to stdout, ' +
        'which would put it into the chat transcript. If you genuinely need to read your key, run it ' +
        'yourself in a private terminal.',
    };
  }

  // 2. Interactive auth belongs in a private terminal. Even the flagless
  // command prompts for account details and an OTP.
  if (AUTH_CONFIGURE.test(command)) {
    return {
      block: true,
      reason:
        'AUTH_INPUT_DENIED: Run `lua auth configure` yourself in a private terminal. ' +
        'Do not enter your email, OTP, or credential in the Codex conversation.',
    };
  }

  // 2b. Logging out discards the credential the user authenticated with. No
  // plugin flow needs it and no plugin flow can put it back.
  if (AUTH_LOGOUT.test(command)) {
    return {
      block: true,
      reason:
        'AUTH_LOGOUT_DENIED: Refused to run `lua auth logout` — it discards the credential this project ' +
        'is authenticated with, and nothing in the plugin can restore it. Run it yourself if you mean to ' +
        'sign out.',
    };
  }

  // 3. --auto-deploy — never. Bypasses the §3.3 confirmation contract.
  if (/--auto-deploy\b/.test(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_AUTO: Refused to run a command containing `--auto-deploy`. The §3.3 deploy-safety ' +
        'contract requires explicit user confirmation before any production deploy. Use `/lua-deploy` ' +
        '(which walks the gated 5-step ship sequence) or run `lua deploy` directly without `--auto-deploy`.',
    };
  }

  // 4. Bare `lua deploy` — only allowed when LUA_DEPLOY_CONFIRMED=1 is set
  // inline (which the confirm-deploy.mjs hook does after the user OKs the
  // /lua-deploy gated flow).
  if (DEPLOY.test(command) && !/\bLUA_DEPLOY_CONFIRMED=1\b/.test(command)) {
    return {
      block: true,
      reason:
        'DEPLOY_DENIED_BARE: Refused to run bare `lua deploy`. The §3.3 deploy-safety contract requires ' +
        'explicit user confirmation. Use `/lua-deploy` (which walks the gated 5-step ship sequence) or ' +
        'run with the confirmation env-var set: `LUA_DEPLOY_CONFIRMED=1 lua deploy …`.',
    };
  }

  return null;
}

/* istanbul ignore next */
if (isMainScript(import.meta.url)) {
  checkNodeVersion();
  await runHook('before-shell-execution', decide);
}
