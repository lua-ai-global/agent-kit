export function splitFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error('missing frontmatter');
  const fields = {};
  for (const line of m[1].split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { fields, body: text.slice(m[0].length) };
}

export function agentToToml(text, modelComment) {
  const { fields, body } = splitFrontmatter(text);
  return [
    `name = "${fields.name}"`,
    'description = """',
    fields.description,
    '"""',
    modelComment,
    '',
    'developer_instructions = """',
    `${body.replace(/^\n/, '')}"""`,
    '',
  ].join('\n');
}

export function knowledgeToMdc(text, description) {
  return `---\ndescription: ${description}\nglobs:\nalwaysApply: false\n---\n\n${text}`;
}
