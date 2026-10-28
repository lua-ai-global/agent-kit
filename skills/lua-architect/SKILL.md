---
name: lua-architect
description: "Plan a Lua agent end-to-end from a goal — persona, skills and tools, integrations (MCP-first), event handlers, jobs, workflows, processors, channels, build order. Spawns the lua-architect subagent; the plan ends with the slash commands to run next (no auto-build)."
metadata:
  lua-agent-builder-tier: "C"
---

> **Tier C: the deploy gate is not enforced on this agent.** This agent runs no hook that can stop a command,
> so these skills never run a command that changes production. The production verbs are `lua deploy`, `lua skills deploy`, `lua skills production deploy`, `lua webhooks deploy`, `lua jobs deploy`, `lua preprocessors deploy`, `lua postprocessors deploy`, `lua persona production deploy`, `lua workflows deploy`, `lua workflows activate`, `lua version promote`, `lua mcp activate`, `lua marketplace template publish`, `lua marketplace template apply`, under any of the names `lua`, `heylua` and `lua-ai`.
> When a step below reaches one, print the exact command with its `LUA_DEPLOY_CONFIRMED=1` prefix for the user
> to run in their own terminal, and stop. Never pass `--auto-deploy`. Never run `lua auth key`, `lua auth configure`
> or `lua auth logout`: the first prints the API key into this conversation, the second collects an email and a
> one-time code, the third discards the credential. A command that changes organisation settings (`lua env`,
> `lua drains`, `lua devices`, `lua decisions publish|delete`, `lua browser run`, `lua integrations`, the
> `lua workflows` run controls) needs the user's explicit yes in this conversation before you run it.

You are `/lua-architect`. The user typed `/lua-architect $ARGUMENTS` (their goal, possibly multi-paragraph).

## Step 1 — capture the goal (single permission per §3.7)

If `$ARGUMENTS` is concrete enough to plan from, use it directly.

If it is empty or vague (one or two words), ask the user **once**:

- "What should the agent do? (a paragraph is fine)" (free-text, required)
- "Who is the user?" (options: `External customers (B2C)`, `Internal team`, `Partners / B2B`, `Other`)
- "Channel(s)?" (multi-select: `WhatsApp`, `Web chat / website`, `Slack`, `Teams`, `Email`, `Voice / phone`, `API`, `Instagram / Messenger`, `Other`)
- "Systems to integrate, and anything that needs a human approval or runs long?" (free-text, optional)

If a Lua project exists in CWD (`lua.skill.yaml`), the architect reads it and `lua status --json --ci` itself.

## Step 2 — invoke lua-architect via the Agent tool

follow the brief in `../lua-agent-builder/references/agents/lua-architect.md` yourself and the goal + context as the prompt. The architect (`../lua-agent-builder/references/agents/lua-architect.md`):

1. Reads the five knowledge files (primitives, workflows, integrations, cli-reference, decision-trees — all verified against lua-cli 3.33.0).
2. Reads the local project if any, and the integration/MCP state it can query read-only.
3. Produces the plan: persona & model, skills/tools (MCP-first — no custom CRUD over an integration), integrations + events, webhooks/triggers, jobs, workflows (when the job-vs-workflow rule says so), processors, data model, build order, verification, trade-offs.

It does not re-prompt.

## Step 3 — present the plan

The plan ends with a "Next steps" menu: `/lua-init`, `/lua-new <type> <name>`, `/lua-test`, `/lua-workflow run <name>`, `/lua-qa`, `/lua-deploy`, `/lua-template`. The user picks; nothing is auto-built. If the user says "go", drive those slashes in order via the skill — each keeps its own single permission interaction.
