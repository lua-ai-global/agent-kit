#!/usr/bin/env node
// Validates .codex-plugin/plugin.json against Codex CLI's manifest schema.
//
// Reference: https://developers.openai.com/codex/plugins/build
// Required: name (kebab-case), version, description.
// Optional: author, homepage, repository, license, keywords, displayName,
// shortDescription, longDescription, developerName, category, capabilities,
// websiteURL, privacyPolicyURL, termsOfServiceURL, defaultPrompt, brandColor,
// composerIcon, logo, screenshots, skills, mcpServers, apps, hooks.

import { readFile } from 'node:fs/promises';

const MANIFEST = '.codex-plugin/plugin.json';

const KNOWN_FIELDS = new Set([
  '$schema',
  'name', 'version', 'description',
  'author', 'homepage', 'repository', 'license', 'keywords',
  'displayName', 'shortDescription', 'longDescription', 'developerName',
  'category', 'capabilities', 'websiteURL', 'privacyPolicyURL',
  'termsOfServiceURL', 'defaultPrompt', 'brandColor', 'composerIcon',
  'logo', 'screenshots',
  'skills', 'mcpServers', 'apps', 'hooks',
]);

const NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;

let failed = false;
const fail = (msg) => { console.error(`✗ ${MANIFEST}: ${msg}`); failed = true; };

let raw;
try { raw = await readFile(MANIFEST, 'utf8'); }
catch { fail('file not found at expected path'); process.exit(1); }

let manifest;
try { manifest = JSON.parse(raw); }
catch (e) { fail(`invalid JSON: ${e.message}`); process.exit(1); }

if (!manifest.name) {
  fail('missing required field `name`');
} else if (typeof manifest.name !== 'string') {
  fail(`\`name\` must be a string`);
} else if (!NAME_RE.test(manifest.name)) {
  fail(`\`name\` "${manifest.name}" is not valid kebab-case (must match ${NAME_RE})`);
}

if (!manifest.version) {
  fail('missing required field `version`');
} else if (!SEMVER_RE.test(manifest.version)) {
  fail(`\`version\` "${manifest.version}" is not a valid semver string`);
}

if (!manifest.description) {
  fail('missing required field `description`');
}

for (const key of Object.keys(manifest)) {
  if (!KNOWN_FIELDS.has(key)) {
    fail(`unknown field "${key}" — not in Codex's documented schema (https://developers.openai.com/codex/plugins/build)`);
  }
}

if (manifest.author && typeof manifest.author === 'object' && !manifest.author.name) {
  fail('`author` is an object but missing required `name` subfield');
}

if (failed) {
  console.error('\nFix the manifest. Reference: https://developers.openai.com/codex/plugins/build');
  process.exit(1);
}
console.log(`✓ .codex-plugin/plugin.json: schema valid (${Object.keys(manifest).length} field(s) recognised, name="${manifest.name}", version="${manifest.version}").`);
