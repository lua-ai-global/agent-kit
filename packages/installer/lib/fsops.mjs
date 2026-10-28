import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SYMLINK_UNSUPPORTED = new Set(['EPERM', 'ENOSYS', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP']);

function listFiles(root, rel = '', out = []) {
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(root, path, out);
    else out.push(path);
  }
  return out;
}

export function digestTree(root) {
  const hash = createHash('sha256');
  if (!lstatSync(root).isDirectory()) return hash.update(readFileSync(root)).digest('hex');
  for (const rel of listFiles(root)) {
    hash.update(`${rel}\0`);
    hash.update(readFileSync(join(root, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function pathKind(path) {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return 'link';
    return st.isDirectory() ? 'dir' : 'file';
  } catch {
    return 'none';
  }
}

export function linkTarget(path) {
  return resolve(dirname(path), readlinkSync(path));
}

export function isInside(path, root) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== '..');
}

function tmpSibling(path) {
  return join(dirname(path), `.${path.split(sep).pop()}.tmp-${process.pid}`);
}

export function atomicCopy(source, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = tmpSibling(dest);
  rmSync(tmp, { recursive: true, force: true });
  cpSync(source, tmp, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
}

export function atomicLink(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = tmpSibling(path);
  rmSync(tmp, { recursive: true, force: true });
  try {
    symlinkSync(target, tmp, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    if (SYMLINK_UNSUPPORTED.has(err.code)) return false;
    throw err;
  }
  renameSync(tmp, path);
  return true;
}

export function linkOrCopy(target, path, { forceCopy, symlinks = true }) {
  if (!forceCopy && symlinks && atomicLink(target, path)) return 'link';
  atomicCopy(target, path);
  return 'copy';
}

export function remove(path) {
  rmSync(path, { recursive: true, force: true });
}

export function exists(path) {
  return existsSync(path);
}
