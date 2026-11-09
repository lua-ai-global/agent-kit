# Lua agent kit

Everything your coding agent needs to build, test and ship [Lua](https://heylua.ai) agents.

## Install

Skills, for every coding agent (Claude Code, Codex, Cursor, Copilot, Gemini CLI and 40+ more):

```bash
npx skills add lua-ai-global/agent-kit
```

Safety checks and Lua tools, for Claude Code:

```bash
claude plugin marketplace add lua-ai-global/agent-kit
claude plugin install lua-agent-builder@lua-ai
```

Safety checks and Lua tools, for Codex:

```bash
codex plugin marketplace add lua-ai-global/agent-kit
codex plugin add lua-agent-builder@lua-ai
```

In Codex, run `/hooks` once and trust the Lua hooks.

Safety checks and Lua tools, for Cursor:

```bash
agent plugin marketplace add https://github.com/lua-ai-global/agent-kit
```

Then open `/plugins` in `agent` (or **Customize** in the Cursor app) and install `lua-agent-builder`.

## What you get

- **Skills**: how to create, test, push and deploy Lua agents with [lua-cli](https://www.npmjs.com/package/lua-cli).
- **Safety checks** (Claude Code, Codex and Cursor plugins): your agent can't deploy to production or print your API key without asking you first.
- **Lua tools** (Claude Code, Codex and Cursor plugins): your agent can see your agents, versions and logs directly.

On other agents, the skills show you the production commands to run yourself instead of running them.

Docs: https://docs.heylua.ai
