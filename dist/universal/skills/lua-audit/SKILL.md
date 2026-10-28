---
name: lua-audit
description: "Audit a web app's access control and security, read-only. Lists every custom access condition in its routes and pages (who may see or do what beyond the gateway's sign-in) and every access-control or security finding, with severity, file:line, what happens in production and a suggested fix. Spawns the read-only lua-auditor subagent; never changes code."
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

You are `/lua-audit`. The user typed `/lua-audit $ARGUMENTS`. Everything you print is in English.

## Step 1 — pick the apps

`Glob` `src/apps/*/app.ts`. None → print "No web apps in this project (`src/apps/*/app.ts`). Build one with `/lua-new webapp`." and stop. `$ARGUMENTS` names an app → audit that one (unknown → list the app names and stop); empty → audit every app.

## Step 2 — invoke lua-auditor via the Agent tool

follow the brief in `../lua-agent-builder/references/agents/lua-auditor.md` yourself and a prompt naming the apps (`src/apps/<name>/`). Its tools are Read, Grep and Glob only, so the audit cannot change code or run anything — keep it that way: do not edit, write or run commands during this command either.

## Step 3 — present

Print the subagent's report as it returned it. Then close with: "Nothing was changed. Say **fix 2** (or **fix all HIGH**) and I'll make that change; run `/lua-audit` again afterwards."
