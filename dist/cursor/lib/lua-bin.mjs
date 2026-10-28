export const LUA_BINARIES = Object.freeze(['lua', 'heylua', 'lua-ai', 'lua-cli']);

const START = String.raw`(?:^|[\s;&|(\`'"])`;
const PATH_PREFIX = String.raw`(?:[^\s;&|()\`'"]*[/\\])?`;
const NAME = `(?:${LUA_BINARIES.join('|')})`;
const EXTENSION = String.raw`(?:\.(?:cmd|exe|ps1|[mc]?js))?`;

export const LUA_BIN = `${START}${PATH_PREFIX}${NAME}${EXTENSION}\\s+`;

export function luaCommand(...verb) {
  return new RegExp(`${LUA_BIN}${verb.join(String.raw`\s+`)}\\b`, 'i');
}
