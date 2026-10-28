import { runHook, checkNodeVersion, isMainScript } from '../lib/hook-runtime.mjs';
import { luaCommand } from '../lib/lua-bin.mjs';

const AUTH_CONFIGURE = luaCommand('auth', 'configure');

export function decide(input) {
  const command = input?.tool_input?.command ?? '';
  if (!AUTH_CONFIGURE.test(command)) return null;

  return {
    block: true,
    reason:
      'AUTH_INPUT_DENIED: Run `lua auth configure` yourself in a private terminal. ' +
      'Do not enter your email, OTP, or credential in the Claude conversation.',
  };
}

/* istanbul ignore next */
if (isMainScript(import.meta.url)) {
  checkNodeVersion();
  await runHook('block-auth-configure', decide);
}
