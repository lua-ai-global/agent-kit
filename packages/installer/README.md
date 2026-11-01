# lua-agent-kit

Install the Lua Agent Builder into every coding agent you use, with one command.

```bash
npx lua-agent-kit@beta
```

The installer finds the coding agents on your machine and asks which ones to set up:

- **Claude Code, Codex and Cursor** get the full plugin: the Lua skills, the safety hooks that stop an unconfirmed production deploy or a credential leak, and the Lua tools.
- **Every other agent that reads `.agents/skills`** (Copilot, Gemini CLI, OpenCode, Amp and more) gets the skills. Anything that would change production is printed for you to run, never run for you.

Nothing is installed until you confirm the list. The installer sends no telemetry and never reads a credential.

## Commands

```bash
npx lua-agent-kit@beta install     # pick agents and install (the default)
npx lua-agent-kit@beta doctor      # what is installed, and a live check that the deploy gate blocks
npx lua-agent-kit@beta update      # move every installed agent to this version
npx lua-agent-kit@beta uninstall   # remove everything the installer wrote
```

Useful flags:

| Flag | What it does |
| --- | --- |
| `--agent <id>` | Install for one agent without the picker (`claude-code`, `codex`, `cursor`, `gemini`, `copilot`, `grok`, `amp`, `opencode`, `windsurf`, or `*`). Repeatable. |
| `--project` | Install into the current project instead of your user settings. |
| `--dry-run` | Show every file it would write, and write nothing. |
| `--yes` | Skip the confirmation, for scripts and CI. |
| `--copy` | Copy files instead of linking them. |

## Where things go

The kit keeps one copy of each version in `~/.lua/agent-kit/<version>/` and links each agent to it, so updating one version updates every agent. Folders you created yourself are never overwritten; the installer reports them and leaves them alone.

You need Node 18 or later, and [lua-cli](https://www.npmjs.com/package/lua-cli) for the Lua commands the skills run.

Docs: https://docs.heylua.ai
