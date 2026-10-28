const PLUGIN = 'plugins/lua-agent-builder';

export const name = 'claude-code';

export const mounts = [
  { from: 'adapters/claude-code/templates/repo', to: '.' },
  { from: 'adapters/claude-code/templates/plugin', to: PLUGIN },
  { from: 'src/docs/JOB_TIER.md', to: 'docs/JOB_TIER.md' },
  { from: 'packages/core/lib', to: `${PLUGIN}/lib`, exclude: ['host.mjs', 'host-runtime.mjs', 'host-default.mjs'] },
  { from: 'packages/core/hooks', to: `${PLUGIN}/hooks` },
  { from: 'packages/core/test/hooks', to: `${PLUGIN}/test/hooks` },
  { from: 'packages/core/test/lib', to: `${PLUGIN}/test/lib` },
  { from: 'packages/core/test/helpers', to: `${PLUGIN}/test/helpers` },
  { from: 'src/commands', to: `${PLUGIN}/commands` },
  { from: 'src/agents', to: `${PLUGIN}/agents` },
  { from: 'qa/agents', to: `${PLUGIN}/agents` },
  { from: 'src/knowledge', to: `${PLUGIN}/lib/knowledge` },
  { from: 'qa/knowledge', to: `${PLUGIN}/lib/knowledge/qa` },
  { from: 'qa/lib', to: `${PLUGIN}/lib/qa` },
  { from: 'qa/test', to: `${PLUGIN}/test/lib/qa` },
  { from: 'qa/hooks', to: `${PLUGIN}/hooks` },
  { from: 'qa/test-hooks', to: `${PLUGIN}/test/hooks` },
  { from: 'src/permissions/permissions-template.json', to: `${PLUGIN}/lib/permissions-template.json` },
  { from: 'src/hooks/hooks.json', to: `${PLUGIN}/hooks/hooks.json` },
  { from: 'src/mcp/mcp.json', to: `${PLUGIN}/.mcp.json` },
  { from: 'packages/mcp-lua-platform', to: `${PLUGIN}/mcp/lua-platform`, exclude: ['node_modules', 'coverage'] },
];
