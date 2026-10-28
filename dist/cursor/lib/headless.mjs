// Headless mode. See docs/TESTERS.md for how the plugin behaves unattended.
//
// `LUA_PLUGIN_HEADLESS=1` tells the hooks that no human is in the loop — the
// plugin runs inside a non-interactive Cursor agent run (or any other
// unattended harness). In that mode:
//
//   * no hook message points at a skill. The skills that fix things
//     (lua-auth, lua-doctor, lua-update, lua-deploy, lua-template) all need
//     to ask the user something or to invoke another agent, neither of which
//     is available headless, and a message naming one steers the model into
//     a flow that cannot complete;
//   * confirm-deploy treats the LUA_DEPLOY_CONFIRMED=1 prefix as VOID. The
//     prefix means "a person confirmed this deploy"; headless, the model
//     would be confirming to itself. Every production verb is blocked (fail
//     closed); production changes are made outside the run;
//   * post-deploy-smoke never sends its production `lua chat` ping.
//
// Blocking behaviour is otherwise identical: every command that is blocked
// interactively is blocked headless too.

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function isHeadless(env = process.env) {
  return TRUTHY.has(String(env?.LUA_PLUGIN_HEADLESS ?? '').trim().toLowerCase());
}

/** The sentence every headless message ends with instead of a skill name. */
export const HEADLESS_NOTE =
  'This is a headless run (LUA_PLUGIN_HEADLESS=1): there is no one to answer a prompt, so do not start ' +
  'an interactive sign-in, install or deploy flow — continue with the task, or report the problem in your result.';
