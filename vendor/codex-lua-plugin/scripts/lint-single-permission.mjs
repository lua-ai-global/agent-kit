#!/usr/bin/env node
// Smoke check for the §3.7 single-permission contract: a skill collects what
// it needs in ONE question, then runs.
//
// This lint is not the contract's source of truth — a SKILL.md is a model
// prompt, not executable code, so only a run that counts real prompts can
// prove the contract holds. What it catches is the naive shape: a skill that
// spells out a question per step, which reads to the model as permission to
// interrogate the user all the way down.
//
// A skill that legitimately needs several passes (lua-doctor's staged
// diagnostic is the standing example) opts out with `x-lua-multi-step: true`
// in its frontmatter. The `x-` prefix marks it as a local extension so it can
// never collide with a host field — the Claude Code port learned this the
// hard way, having used `permission-mode: stepwise`, a field no host has.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Both spellings the skills use for "ask the user": the Codex idiom and the
// Claude Code tool name that the ported flows still mention in places.
const ASK_RE = /ask-user-question|AskUserQuestion/gi;
const NUMBERED_STEP_ASK_RE = /^(?:#{1,6}\s*)?(?:Step\s*)?[0-9]+[.)]\s.*(?:ask-user-question|AskUserQuestion)/gim;
const MAX_ASKS = 5;

let failed = false;

let dirs;
try {
  dirs = (await readdir('skills', { withFileTypes: true })).filter((e) => e.isDirectory());
} catch {
  console.log('✓ skills/ does not exist yet — skipping.');
  process.exit(0);
}

let checked = 0;
for (const dir of dirs) {
  const path = join('skills', dir.name, 'SKILL.md');
  let content;
  try { content = await readFile(path, 'utf8'); } catch { continue; }
  checked++;

  if (/^x-lua-multi-step:\s*true/m.test(content)) continue;

  const askCount = (content.match(ASK_RE) ?? []).length;
  if (askCount > MAX_ASKS) {
    console.error(`✗ ${path}: ${askCount} mentions of a user question (>${MAX_ASKS}) — likely breaks the §3.7 single-permission contract.`);
    console.error('    Consolidate the questions into one multi-question pass, or add `x-lua-multi-step: true` to the frontmatter if the skill genuinely needs several (as lua-doctor does).');
    failed = true;
  }

  const stepwiseAsks = (content.match(NUMBERED_STEP_ASK_RE) ?? []).length;
  if (stepwiseAsks > 1) {
    console.error(`✗ ${path}: ${stepwiseAsks} numbered steps each ask the user something. Collapse them into a single question (§3.7), or add \`x-lua-multi-step: true\`.`);
    failed = true;
  }
}

if (checked === 0 && !failed) {
  console.error('✗ Found 0 SKILL.md files under skills/. Either the layout changed or this lint is reading the wrong path. Refusing to pass silently.');
  failed = true;
}

if (failed) {
  console.error('\nReview the skill bodies above. Several separate questions in one flow break the single-permission contract.');
  process.exit(1);
}
console.log(`✓ ${checked} skill(s) pass the single-permission smoke check.`);
