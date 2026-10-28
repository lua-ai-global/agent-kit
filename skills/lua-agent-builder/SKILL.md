---
name: lua-agent-builder
description: Build, test and ship Lua AI agents (heylua.ai) with lua-cli. Start here for any Lua agent task; it lists the lua-* skills, the reference files they read, and the safety rules that apply on agents without a deploy gate.
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

# Lua Agent Builder

lua-cli is a TypeScript SDK and CLI for Lua AI agents. Every `lua-*` skill next to this one wraps one part of it.

## Skills

- `lua-architect`: Plan a Lua agent end-to-end from a goal — persona, skills and tools, integrations (MCP-first), event handlers, jobs, workflows, processors, channels, build order. Spawns the lua-architect subagent; the plan ends with the slash commands to run next (no auto-build).
- `lua-audit`: Audit a web app's access control and security, read-only. Lists every custom access condition in its routes and pages (who may see or do what beyond the gateway's sign-in) and every access-control or security finding, with severity, file:line, what happens in production and a suggested fix. Spawns the read-only lua-auditor subagent; never changes code.
- `lua-auth`: Authenticate with Lua through lua-cli's private interactive login. Existing credentials (LUA_API_KEY, .env, the stored session, or the credentials file) remain valid and are never printed.
- `lua-browser`: Try the agent's cloud browser from the terminal — read one page, give the browser a task and watch each step, list or delete the agent's named browsers. Wraps `lua browser read|run` and `lua browsers list|delete`; a read runs at once, a run acts on real websites and confirms once.
- `lua-chat`: Send a one-shot message to the agent in sandbox or production on an isolated thread. Wraps `lua chat --ci -e <env> -m "<text>" -t [id]`.
- `lua-decisions`: The agent's named decisions (LuaDecision) — list, versions, run one with a message or JSON state (optionally on another provider or model), publish a version (rollback) or delete. Wraps `lua decisions <verb> [name] [version]`; reads and runs go at once, publish and delete confirm once.
- `lua-deploy`: Make something live in production — a primitive version, the persona, a workflow version, a web app, an MCP activation, or an agent-version promote (also the rollback path). Single permission per §3.7; spawns the lua-deploy-pilot subagent for the gated ship sequence.
- `lua-devices`: Connect hardware or a local machine to the agent as a device — choose self-describing vs defineDevice, issue a device credential safely (always to a git-ignored file), scaffold a Node / Python / Pico W client, push and go live, test commands and triggers, read device logs, troubleshoot. Wraps `lua devices <verb> --ci` (⏳ some verbs need lua-cli 3.45.0; 3.44 fallbacks built in).
- `lua-docs`: Look something up in the lua-cli / Lua platform documentation (docs.heylua.ai) via the public docs MCP server, with WebFetch as the fallback. Never shells out to `lua docs` (it only opens a browser).
- `lua-doctor`: Diagnostic and assisted repair for the Lua plugin environment. Probes Node, npm, lua-cli, authentication and the permission rules in order; offers explicit-consent fixes for each.
- `lua-drains`: Manage the organization's log drains — list/status/deliveries, create/update/delete, test/verify, pause/resume and rotate-secret. Wraps `lua drains <verb> [id]`; the signing secret is printed once and never stored, header values never reach a command line.
- `lua-env`: Manage agent environment variables — list, set or delete a key in sandbox (the project's .env) or production. Wraps `lua env <sandbox|staging|production> --list | -k KEY -v VALUE | -k KEY --delete`; the value never appears in the conversation.
- `lua-init`: Initialize a Lua agent project in the current directory — new agent, existing agent, or a duplicate — with `lua init --ci`. Collects name, organization, model (from the live catalog), examples and promo code; routes missing authentication through the private CLI login.
- `lua-integrations`: Wire third-party SaaS through Unified.to — browse the catalog, inspect a connector, list connections, manage their auto-provisioned MCP servers and event subscriptions (webhooks/triggers), disconnect or convert. Wraps `lua integrations <action>`; the browser-based connect/update flows are printed for the user's own terminal.
- `lua-logs`: View agent logs (skills, jobs, webhooks, triggers, processors, MCP, workflows, runtime errors, voice calls) as structured JSON, over a time window and optionally followed live. Wraps `lua logs --ci --json`.
- `lua-new`: Scaffold a new Lua primitive (tool, skill, webhook, trigger, job, preprocessor, postprocessor, mcp, device, device-trigger, voice, workflow, workflow-script, webapp, decision, browser), register it in the LuaAgent, compile and test it. Spawns the lua-skill-builder subagent.
- `lua-push`: Push a primitive (skill/webhook/trigger/job/processor/mcp/device/device-trigger/voice/workflow/webapp/decision/browser/agent config/backup) or stage everything with `lua push … --ci --force`. Creates server versions; nothing goes live. Never adds --auto-deploy.
- `lua-status`: Show the full state of the current Lua project — auth, CLI version/updates, agent, per-primitive local-vs-deployed sync, persona and backup status, warnings. Wraps `lua status --json --ci` (read-only, no prompt).
- `lua-sync`: Detect drift between local code and the server and resolve it. Wraps `lua status --json`, `lua sync --check`, then `lua sync --pull` or `lua sync --push` based on the user's choice.
- `lua-template`: Marketplace agent templates — package this agent for other organizations. Inspect (view/versions/status/health/installed), create a template record, draft the `template:` manifest, publish a version, install, or apply to installed agents. Wraps `lua marketplace template <action>`; publish and apply are production-affecting and prefixed.
- `lua-test`: Run a skill (one of its tools), webhook, job, preprocessor, postprocessor, workflow or web-app route locally with `lua test --ci`. Inputs collected up-front; on failure hands the output to the lua-debug subagent.
- `lua-update`: Update lua-cli to the latest published version via `npm install -g lua-cli@latest` (the CLI's own `lua update` has no flags and is interactive-free but we run npm directly so the result is visible).
- `lua-version`: Agent versions — atomic snapshots of the whole staged agent. List, show, diff and compare against local (`lua version list|show|diff|status`), create a snapshot (`lua version create`). Promoting a version to live (incl. rollback) goes through /lua-deploy.
- `lua-workflow`: Work with Lua workflows — run one offline with scripted approvals/signals, list/inspect runs, start/watch a run, approve/signal/resume/cancel a parked run. Wraps `lua workflows <verb>` and `lua test workflow`. Deploying a workflow goes through /lua-deploy.

## Reference files

The skills read these files; they are verified against lua-cli source and win over the public docs where the two disagree.

- `references/browser.md`
- `references/cli-reference.md`
- `references/decision-trees.md`
- `references/decisions.md`
- `references/devices.md`
- `references/integrations.md`
- `references/log-drains.md`
- `references/primitives.md`
- `references/web-apps.md`
- `references/workflows.md`

The `references/agents/` files are briefs that other agents run as subagents. Here you follow a brief yourself, in the same conversation.
