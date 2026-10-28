import { cpSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { atomicCopy, atomicLink, digestTree, exists, linkTarget, pathKind } from './fsops.mjs';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function kitHome(env = process.env, home = homedir()) {
  return env.XDG_DATA_HOME ? join(env.XDG_DATA_HOME, 'lua', 'agent-kit') : join(home, '.lua', 'agent-kit');
}

export function hubPaths(root) {
  return {
    root,
    current: join(root, 'current'),
    state: join(root, 'installed.json'),
    data: join(root, 'data'),
    version: (v) => join(root, v),
  };
}

export function hubVersions(root) {
  if (!exists(root)) return [];
  return readdirSync(root).filter((name) => VERSION_RE.test(name)).sort(compareVersions);
}

export function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((x) => (Number.isNaN(Number(x)) ? x : Number(x)));
  const pb = b.split(/[.-]/).map((x) => (Number.isNaN(Number(x)) ? x : Number(x)));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if (pa[i] === pb[i]) continue;
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function restoreDotfiles(dir, suffix) {
  if (!suffix) return;
  for (const rel of readdirSync(dir, { recursive: true }).map(String)) {
    if (!rel.endsWith(suffix)) continue;
    const name = basename(rel).slice(0, -suffix.length);
    renameSync(join(dir, rel), join(dir, dirname(rel), `.${name}`));
  }
}

export function materialise(hub, payload) {
  const dest = hub.version(payload.version);
  const digest = digestTree(payload.dir);
  if (exists(dest) && readMarker(dest) === digest) return { path: dest, changed: false };
  const tmp = join(hub.root, `.tmp-${process.pid}-${payload.version}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(hub.root, { recursive: true });
  cpSync(payload.dir, tmp, { recursive: true });
  restoreDotfiles(tmp, payload.manifest.dotfileSuffix);
  writeFileSync(join(tmp, '.digest'), `${digest}\n`);
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
  return { path: dest, changed: true };
}

function readMarker(dir) {
  try {
    return readFileSync(join(dir, '.digest'), 'utf8').trim();
  } catch {
    return null;
  }
}

export function currentVersion(hub) {
  const kind = pathKind(hub.current);
  if (kind === 'link') return linkTarget(hub.current).split(/[\\/]/).pop();
  if (kind === 'dir') return readMarkerVersion(hub.current);
  return null;
}

function readMarkerVersion(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

export function setCurrent(hub, version, { symlinks = true } = {}) {
  mkdirSync(hub.root, { recursive: true });
  if (symlinks && atomicLink(version, hub.current)) return 'link';
  atomicCopy(hub.version(version), hub.current);
  return 'copy';
}

export function prune(hub, keep = 2) {
  const versions = hubVersions(hub.root);
  const current = currentVersion(hub);
  const removable = versions.filter((v) => v !== current).slice(0, Math.max(0, versions.length - keep));
  for (const v of removable) rmSync(hub.version(v), { recursive: true, force: true });
  return removable;
}

export function removeHub(hub, { purgeData }) {
  for (const v of hubVersions(hub.root)) rmSync(hub.version(v), { recursive: true, force: true });
  rmSync(hub.current, { recursive: true, force: true });
  rmSync(hub.state, { force: true });
  if (purgeData) rmSync(hub.data, { recursive: true, force: true });
  if (exists(hub.root) && readdirSync(hub.root).length === 0) rmSync(hub.root, { recursive: true, force: true });
}

export function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}
