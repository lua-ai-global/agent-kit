const LETTERS = [
  '██╗     ██╗   ██╗ █████╗ ',
  '██║     ██║   ██║██╔══██╗',
  '██║     ██║   ██║███████║',
  '██║     ██║   ██║██╔══██║',
  '███████╗╚██████╔╝██║  ██║',
  '╚══════╝ ╚═════╝ ╚═╝  ╚═╝',
];

const ORANGE = '\x1b[38;2;255;138;0m';
const RESET = '\x1b[0m';

export function banner(color) {
  const lines = color ? LETTERS.map((l) => `${ORANGE}${l}${RESET}`) : LETTERS;
  return `\n${lines.join('\n')}\n`;
}

export function listNames(names, shown = 3) {
  if (names.length <= shown) return names.join(', ');
  return `${names.slice(0, shown).join(', ')} +${names.length - shown} more`;
}
