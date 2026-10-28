export function applyStamps(files, stamps, version) {
  for (const stamp of stamps) {
    const file = files.get(stamp.path);
    if (!file) throw new Error(`stamp: ${stamp.path} is not in the emitted tree`);
    const re = new RegExp(stamp.pattern, 'gm');
    let count = 0;
    const text = file.content.toString('utf8').replace(re, (match, current) => {
      count += 1;
      return match.replace(current, version);
    });
    if (count !== stamp.count) {
      throw new Error(`stamp: ${stamp.path} /${stamp.pattern}/ matched ${count} time(s), expected ${stamp.count}`);
    }
    files.set(stamp.path, { ...file, content: Buffer.from(text, 'utf8') });
  }
}
