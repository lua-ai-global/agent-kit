function isPrimitive(value) {
  return value === null || typeof value !== 'object';
}

function isLeafObject(value) {
  return !isPrimitive(value) && !Array.isArray(value) && Object.values(value).every(isPrimitive);
}

function inlineObject(value) {
  const parts = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{ ${parts.join(', ')} }`;
}

function inlineForm(value, style, inArray) {
  if (isPrimitive(value)) return JSON.stringify(value);
  if (Array.isArray(value) && style.inlinePrimitiveArrays && value.every(isPrimitive)) {
    return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
  }
  if (inArray && style.inlineLeafObjectsInArrays && isLeafObject(value)) return inlineObject(value);
  return null;
}

function format(value, style, depth, inArray) {
  const inline = inlineForm(value, style, inArray);
  if (inline !== null) return inline;
  const pad = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${pad}${format(v, style, depth + 1, true)}`).join(',\n')}\n${close}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const body = entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${format(v, style, depth + 1, false)}`);
  return `{\n${body.join(',\n')}\n${close}}`;
}

export function formatJson(value, style = {}) {
  return `${format(value, style, 0, false)}\n`;
}
