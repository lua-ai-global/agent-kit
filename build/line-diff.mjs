function lcsTable(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  return { table, cols };
}

export function diffHunks(a, b) {
  const { table, cols } = lcsTable(a, b);
  const hunks = [];
  let i = 0;
  let j = 0;
  let open = null;
  const close = () => {
    if (open) hunks.push(open);
    open = null;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i += 1;
      j += 1;
      continue;
    }
    open ??= { aStart: i, removed: [], added: [] };
    if (j < b.length && (i >= a.length || table[i * cols + j + 1] >= table[(i + 1) * cols + j])) {
      open.added.push(b[j]);
      j += 1;
    } else {
      open.removed.push(a[i]);
      i += 1;
    }
  }
  close();
  return hunks;
}
