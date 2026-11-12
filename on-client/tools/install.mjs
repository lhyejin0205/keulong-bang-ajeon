import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_NAME = '.on-starter-manifest.json';
const TARGET_NAME = 'on-client';
const MAX_FILES = 512;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const HELPER_PATH = 'tools/app-credentials.ps1';
const ROOT_FILES = new Set(['package.json', 'README.md', '.env.example']);
const DOC_FILES = new Set([
  'STUDENT_PROMPTS.md',
  'IMPLEMENTATION_CONTRACT.md',
  'STARTER_UPDATE.md',
  'STUDENT_LAUNCH_GUIDE.md',
  'CURRICULUM.json',
  'AI_SETUP_GUIDE.md',
  'PRODUCT_OVERVIEW.md',
]);
const TREE_ROOTS = ['src', 'public', 'student', 'vendor'];
const RESERVED_NAMES = new Set(['.git', 'node_modules', 'receipts', 'test']);
const ERROR_MESSAGES = Object.freeze({
  ERR_ARGS: '인자 또는 경로 형식을 확인하세요.',
  ERR_SOURCE_MISSING: '스타터 폴더를 찾을 수 없습니다.',
  ERR_PROJECT_MISSING: '학생 프로젝트 폴더를 찾을 수 없습니다.',
  ERR_NOT_DIRECTORY: '지정한 경로가 실제 폴더가 아닙니다.',
  ERR_SYMLINK: '링크가 포함된 경로는 사용할 수 없습니다.',
  ERR_HARDLINK: '하드링크 파일은 사용할 수 없습니다.',
  ERR_SAME_PATH: '스타터와 학생 프로젝트 경로가 같습니다.',
  ERR_NESTED: '스타터와 학생 프로젝트 경로를 중첩할 수 없습니다.',
  ERR_LIMIT: '파일 개수 또는 크기 제한을 초과했습니다.',
  ERR_HELPER_SOURCE_UNVERIFIABLE: 'DPAPI helper의 제공 해시를 확인할 수 없습니다.',
  ERR_MANIFEST_INVALID: '대상 매니페스트 형식을 확인할 수 없습니다.',
  ERR_UNVERIFIABLE: '기존 on-client의 출처를 확인할 수 없어 변경하지 않았습니다.',
  ERR_BASELINE_REQUIRED: '기존 설치의 신뢰된 기준 digest가 필요합니다.',
  ERR_BASELINE_MISMATCH: '보관된 기준 digest가 대상 매니페스트와 일치하지 않습니다.',
  ERR_INSTALL_BUSY: '다른 설치 작업이 진행 중입니다.',
  ERR_CONFLICT: '파일 충돌을 확인했습니다.',
  ERR_READ: '입력 파일을 안전하게 읽지 못했습니다.',
  ERR_WRITE: '파일 기록을 완료하지 못했습니다.',
  ERR_INTERNAL: '내부 오류로 작업을 완료하지 못했습니다.',
});

export class InstallError extends Error {
  constructor(code, written = []) {
    super(code);
    this.name = 'InstallError';
    this.code = code;
    this.written = written;
  }
}

const fail = (code, written) => {
  throw new InstallError(code, written);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const samePath = (left, right) => path.relative(left, right) === '';
const isNested = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};
const statIdentity = (value) => [
  value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs, value.nlink,
].join(':');

async function assertNoLinkAncestors(absolutePath) {
  const parsed = path.parse(absolutePath);
  let current = parsed.root;
  const parts = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      fail('ERR_READ');
    }
    if (info.isSymbolicLink()) fail('ERR_SYMLINK');
  }
}

async function requireDirectory(directory) {
  const absolute = path.resolve(directory);
  if (!path.isAbsolute(absolute)) fail('ERR_NOT_DIRECTORY');
  await assertNoLinkAncestors(absolute);
  let info;
  try {
    info = await lstat(absolute);
  } catch {
    fail('ERR_SOURCE_MISSING');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('ERR_NOT_DIRECTORY');
  let canonical;
  try {
    canonical = await realpath(absolute);
  } catch {
    fail('ERR_READ');
  }
  if (!samePath(canonical, absolute)) fail('ERR_SYMLINK');
  return absolute;
}

async function readRegularFile(filePath, maxBytes = MAX_FILE_BYTES) {
  await assertNoLinkAncestors(filePath);
  let before;
  try {
    before = await lstat(filePath);
  } catch {
    fail('ERR_READ');
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1 || before.size > maxBytes) {
    fail(before.nlink > 1 ? 'ERR_HARDLINK' : 'ERR_LIMIT');
  }
  let bytes;
  try {
    const handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || statIdentity(opened) !== statIdentity(before)) fail('ERR_READ');
      bytes = await handle.readFile();
      const after = await handle.stat();
      if (statIdentity(opened) !== statIdentity(after) || bytes.length !== after.size) fail('ERR_READ');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof InstallError) throw error;
    fail('ERR_READ');
  }
  if (bytes.length > maxBytes) fail('ERR_LIMIT');
  return { bytes, identity: statIdentity(before) };
}

function safeRelativePath(relative) {
  if (typeof relative !== 'string' || relative.length === 0 || relative.includes('\0')) return false;
  const pieces = relative.split('/');
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..'
      || /[\\/:*?"<>|]/.test(piece) || /[. ]$/.test(piece))) return false;
  if (pieces.some((piece) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(piece))) return false;
  if (relative !== '.env.example' && pieces.some((piece) => /^\.env(?:\.|$)/i.test(piece))) return false;
  return !path.posix.isAbsolute(relative);
}

function shouldSkip(relative) {
  const pieces = relative.split('/');
  if (pieces.some((piece) => RESERVED_NAMES.has(piece.toLowerCase()))) return true;
  if (relative !== '.env.example' && pieces.some((piece) => /^\.env(?:\.|$)/i.test(piece))) return true;
  const filename = pieces.at(-1).toLowerCase();
  return /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(filename)
    || ['id_rsa', 'id_ed25519', 'credentials.json'].includes(filename);
}

async function collectTree(root, directory, results, total) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    fail('ERR_READ');
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (shouldSkip(relative)) continue;
    if (!safeRelativePath(relative)) fail('ERR_CONFLICT');
    if (relative.startsWith('src/learning/')) continue;
    let info;
    try {
      info = await lstat(absolute);
    } catch {
      fail('ERR_READ');
    }
    if (info.isSymbolicLink()) fail('ERR_SYMLINK');
    if (info.isDirectory()) {
      await collectTree(root, absolute, results, total);
      continue;
    }
    if (!info.isFile()) fail('ERR_CONFLICT');
    const { bytes } = await readRegularFile(absolute);
    total.bytes += bytes.length;
    if (bytes.length > MAX_FILE_BYTES || total.bytes > MAX_TOTAL_BYTES) fail('ERR_LIMIT');
    results.set(relative, { absolute, bytes, hash: sha256(bytes), identity: statIdentity(info) });
    if (results.size > MAX_FILES) fail('ERR_LIMIT');
  }
}

async function sourceFiles(source) {
  const files = new Map();
  let total = { bytes: 0 };
  for (const name of ROOT_FILES) {
    const absolute = path.join(source, name);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail('ERR_SYMLINK');
      if (!info.isFile()) fail('ERR_CONFLICT');
      const { bytes, identity } = await readRegularFile(absolute);
      total.bytes += bytes.length;
      files.set(name, { absolute, bytes, hash: sha256(bytes), identity });
    } catch (error) {
      if (error instanceof InstallError) throw error;
      if (error.code !== 'ENOENT') fail('ERR_READ');
    }
  }
  for (const name of DOC_FILES) {
    const relative = `docs/${name}`;
    const absolute = path.join(source, 'docs', name);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail('ERR_SYMLINK');
      if (!info.isFile()) fail('ERR_CONFLICT');
      const { bytes, identity } = await readRegularFile(absolute);
      total.bytes += bytes.length;
      files.set(relative, { absolute, bytes, hash: sha256(bytes), identity });
    } catch (error) {
      if (error instanceof InstallError) throw error;
      if (error.code !== 'ENOENT') fail('ERR_READ');
    }
  }
  for (const rootName of TREE_ROOTS) {
    const absolute = path.join(source, rootName);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail('ERR_SYMLINK');
      if (!info.isDirectory()) fail('ERR_CONFLICT');
      await collectTree(source, absolute, files, total);
    } catch (error) {
      if (error instanceof InstallError) throw error;
      if (error.code !== 'ENOENT') fail('ERR_READ');
    }
  }
  const helper = path.join(source, HELPER_PATH);
  try {
    const info = await lstat(helper);
    if (info.isSymbolicLink()) fail('ERR_SYMLINK');
    if (!info.isFile()) fail('ERR_CONFLICT');
    const { bytes, identity } = await readRegularFile(helper);
    total.bytes += bytes.length;
    files.set(HELPER_PATH, { absolute: helper, bytes, hash: sha256(bytes), identity });
  } catch (error) {
    if (error instanceof InstallError) throw error;
    if (error.code !== 'ENOENT') fail('ERR_READ');
  }
  if (files.size > MAX_FILES || total.bytes > MAX_TOTAL_BYTES) fail('ERR_LIMIT');
  const foldedPaths = new Map();
  for (const relative of files.keys()) {
    const folded = relative.toLowerCase();
    if (foldedPaths.has(folded) && foldedPaths.get(folded) !== relative) fail('ERR_CONFLICT');
    foldedPaths.set(folded, relative);
  }
  return files;
}

function validateSourceManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !value.sourceHashes
      || typeof value.sourceHashes !== 'object' || Array.isArray(value.sourceHashes)) fail('ERR_HELPER_SOURCE_UNVERIFIABLE');
  for (const [name, hash] of Object.entries(value.sourceHashes)) {
    if (!safeRelativePath(name) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
      fail('ERR_HELPER_SOURCE_UNVERIFIABLE');
    }
  }
  return value.sourceHashes;
}

async function verifySourceHelper(source, files) {
  const helper = files.get(HELPER_PATH);
  const manifestPath = path.join(source, MANIFEST_NAME);
  let manifestBytes;
  try {
    ({ bytes: manifestBytes } = await readRegularFile(manifestPath));
  } catch (error) {
    if (error.code === 'ERR_READ') {
      try {
        await lstat(manifestPath);
      } catch (missing) {
        if (missing.code === 'ENOENT' && !helper) return;
      }
    }
    fail('ERR_HELPER_SOURCE_UNVERIFIABLE');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail('ERR_HELPER_SOURCE_UNVERIFIABLE');
  }
  const sourceHashes = validateSourceManifest(manifest);
  const declaredHash = sourceHashes[HELPER_PATH];
  if (helper && declaredHash !== helper.hash) fail('ERR_HELPER_SOURCE_UNVERIFIABLE');
  if (!helper && declaredHash) fail('ERR_HELPER_SOURCE_UNVERIFIABLE');
}

async function findExistingPath(root, relative) {
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    let names;
    try {
      names = await readdir(current);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      fail('ERR_READ');
    }
    const wanted = parts[index];
    const matches = names.filter((name) => name.toLowerCase() === wanted.toLowerCase());
    if (matches.length > 1 || (matches.length === 1 && matches[0] !== wanted)) fail('ERR_CONFLICT');
    if (matches.length === 0) return null;
    current = path.join(current, matches[0]);
    let info;
    try {
      info = await lstat(current);
    } catch {
      fail('ERR_READ');
    }
    if (info.isSymbolicLink()) fail('ERR_SYMLINK');
    const last = index === parts.length - 1;
    if (last) {
      if (!info.isFile()) fail('ERR_CONFLICT');
      if (info.nlink > 1) fail('ERR_HARDLINK');
      return current;
    }
    if (!info.isDirectory()) fail('ERR_CONFLICT');
  }
  return null;
}

function parseManifest(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('ERR_MANIFEST_INVALID');
  }
  if (!manifest || manifest.version !== 1 || !manifest.sourceHashes
      || typeof manifest.sourceHashes !== 'object' || Array.isArray(manifest.sourceHashes)) fail('ERR_MANIFEST_INVALID');
  for (const [name, hash] of Object.entries(manifest.sourceHashes)) {
    if (!safeRelativePath(name) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
      fail('ERR_MANIFEST_INVALID');
    }
  }
  return manifest;
}

async function readTargetManifest(target) {
  const file = path.join(target, MANIFEST_NAME);
  try {
    const result = await readRegularFile(file, 1024 * 1024);
    return { ...result, manifest: parseManifest(result.bytes) };
  } catch (error) {
    if (error.code === 'ERR_READ') {
      try {
        await lstat(file);
      } catch (missing) {
        if (missing.code === 'ENOENT') return null;
      }
    }
    throw error;
  }
}

async function ensureTargetParent(target, relative) {
  const parts = relative.split('/');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST') fail('ERR_WRITE');
    }
    let info;
    try {
      info = await lstat(current);
    } catch {
      fail('ERR_WRITE');
    }
    if (info.isSymbolicLink()) fail('ERR_SYMLINK');
    if (!info.isDirectory()) fail('ERR_CONFLICT');
  }
  return path.join(target, ...parts);
}

async function writeAtomic(filePath, bytes, expectedIdentity, expectedHash, written, relative) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  let handle;
  try {
    const current = await findExistingPath(path.dirname(filePath), path.basename(filePath));
    if (expectedIdentity === null && current) fail('ERR_CONFLICT', written);
    if (expectedIdentity !== null) {
      if (!current) fail('ERR_CONFLICT', written);
      const currentInfo = await lstat(current);
      const currentFile = await readRegularFile(current);
      if (statIdentity(currentInfo) !== expectedIdentity || sha256(currentFile.bytes) !== expectedHash) {
        fail('ERR_CONFLICT', written);
      }
    }
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (expectedIdentity === null) {
      if (await findExistingPath(path.dirname(filePath), path.basename(filePath))) fail('ERR_CONFLICT', written);
    } else {
      const current = await findExistingPath(path.dirname(filePath), path.basename(filePath));
      if (!current) fail('ERR_CONFLICT', written);
      const currentInfo = await lstat(current);
      const currentFile = await readRegularFile(current);
      if (statIdentity(currentInfo) !== expectedIdentity || sha256(currentFile.bytes) !== expectedHash) {
        fail('ERR_CONFLICT', written);
      }
    }
    await rename(temporary, filePath);
    written.push(relative);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    if (error instanceof InstallError) {
      error.written = written.slice();
      throw error;
    }
    fail('ERR_WRITE', written.slice());
  }
}

async function withInstallLock(project, callback) {
  const lockPath = path.join(project, '.on-client.install.lock');
  let lock;
  let lockIdentity;
  let lockOwner;
  try {
    lock = await open(lockPath, 'wx', 0o600);
    const openedInfo = await lock.stat();
    lockOwner = `${openedInfo.dev}:${openedInfo.ino}`;
    await lock.writeFile(`${process.pid}\n`);
    await lock.sync();
    lockIdentity = statIdentity(await lock.stat());
    await lock.close();
    lock = null;
  } catch (error) {
    if (lock) await lock.close().catch(() => {});
    if (lockOwner) {
      try {
        const current = await lstat(lockPath);
        if (!current.isSymbolicLink() && `${current.dev}:${current.ino}` === lockOwner) {
          await rm(lockPath, { force: true });
        }
      } catch {
        // The original write error is the actionable failure.
      }
    }
    if (error.code === 'EEXIST') fail('ERR_INSTALL_BUSY');
    fail('ERR_WRITE');
  }
  try {
    return await callback();
  } finally {
    try {
      const current = await lstat(lockPath);
      if (!current.isSymbolicLink() && statIdentity(current) === lockIdentity) {
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function installStarterInternal({
  source,
  project,
  apply: shouldApply = false,
  expectedManifestDigest,
} = {}) {
  if (typeof source !== 'string' || typeof project !== 'string' || !source || !project) fail('ERR_ARGS');
  if (typeof shouldApply !== 'boolean') fail('ERR_ARGS');
  if (!path.isAbsolute(source) || !path.isAbsolute(project)) fail('ERR_ARGS');
  const sourceRoot = await requireDirectory(source);
  const projectRoot = await requireDirectory(project).catch((error) => {
    if (error.code === 'ERR_SOURCE_MISSING') fail('ERR_PROJECT_MISSING');
    throw error;
  });
  const targetRoot = path.resolve(projectRoot, TARGET_NAME);
  if (samePath(sourceRoot, projectRoot)) fail('ERR_SAME_PATH');
  if (isNested(sourceRoot, projectRoot) || isNested(projectRoot, sourceRoot)) fail('ERR_NESTED');
  const files = await sourceFiles(sourceRoot);
  await verifySourceHelper(sourceRoot, files);
  const targetExists = await lstat(targetRoot).then((info) => {
    if (info.isSymbolicLink()) fail('ERR_SYMLINK');
    if (!info.isDirectory()) fail('ERR_NOT_DIRECTORY');
    return true;
  }).catch((error) => {
    if (error instanceof InstallError) throw error;
    if (error.code === 'ENOENT') return false;
    fail('ERR_READ');
  });
  let oldManifest = null;
  if (targetExists) {
    oldManifest = await readTargetManifest(targetRoot);
    if (!oldManifest) fail('ERR_UNVERIFIABLE');
    if (typeof expectedManifestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedManifestDigest)) {
      fail('ERR_BASELINE_REQUIRED');
    }
    if (sha256(oldManifest.bytes) !== expectedManifestDigest) fail('ERR_BASELINE_MISMATCH');
  } else if (expectedManifestDigest !== undefined) {
    fail('ERR_ARGS');
  }

  const added = [];
  const updated = [];
  const preserved = [];
  const conflicts = [];
  const sourceHashes = oldManifest ? { ...oldManifest.manifest.sourceHashes } : {};
  const writes = [];
  const targetChecks = [];
  for (const [relative, entry] of files) {
    let existing;
    try {
      existing = targetExists ? await findExistingPath(targetRoot, relative) : null;
    } catch (error) {
      if (error.code !== 'ERR_CONFLICT') throw error;
      conflicts.push(relative);
      continue;
    }
    if (!existing) {
      if (targetExists && relative.startsWith('student/')) {
        preserved.push(relative);
        continue;
      }
      added.push(relative);
      writes.push({ relative, entry, expectedIdentity: null });
      sourceHashes[relative] = entry.hash;
      continue;
    }
    const { bytes, identity } = await readRegularFile(existing);
    const existingHash = sha256(bytes);
    targetChecks.push({ relative, identity, hash: existingHash });
    if (relative.startsWith('student/')) {
      preserved.push(relative);
      continue;
    }
    if (existingHash === entry.hash) {
      sourceHashes[relative] = entry.hash;
      continue;
    }
    const baseline = oldManifest?.manifest.sourceHashes[relative];
    if (!oldManifest || relative.startsWith('student/') || !baseline || existingHash !== baseline) {
      preserved.push(relative);
      continue;
    }
    updated.push(relative);
    writes.push({ relative, entry, expectedIdentity: identity, expectedHash: existingHash });
    sourceHashes[relative] = entry.hash;
  }
  if (conflicts.length && shouldApply) fail('ERR_CONFLICT');
  if (Object.keys(sourceHashes).length > MAX_FILES) fail('ERR_LIMIT');
  const manifestBytes = Buffer.from(`${JSON.stringify({
    version: 1,
    sourceHashes,
  }, null, 2)}\n`, 'utf8');
  const manifestDigest = sha256(manifestBytes);
  const result = { added, updated, preserved, conflicts, written: [], manifestDigest };
  if (!shouldApply) return result;

  return withInstallLock(projectRoot, async () => {
    let target = targetRoot;
    try {
      if (!targetExists) {
        await mkdir(targetRoot);
      } else {
        const freshManifest = await readTargetManifest(targetRoot);
        if (!freshManifest || sha256(freshManifest.bytes) !== expectedManifestDigest) fail('ERR_BASELINE_MISMATCH');
      }
      if (targetExists) {
        for (const snapshot of targetChecks) {
          const current = await findExistingPath(target, snapshot.relative);
          if (!current) fail('ERR_CONFLICT', result.written);
          const currentFile = await readRegularFile(current);
          if (currentFile.identity !== snapshot.identity || sha256(currentFile.bytes) !== snapshot.hash) {
            fail('ERR_CONFLICT', result.written);
          }
        }
      }
      for (const item of writes) {
        const freshSource = await readRegularFile(item.entry.absolute);
        if (freshSource.identity !== item.entry.identity || sha256(freshSource.bytes) !== item.entry.hash) {
          fail('ERR_CONFLICT', result.written);
        }
        const destination = await ensureTargetParent(target, item.relative);
        const now = await findExistingPath(target, item.relative);
        if (item.expectedIdentity === null && now) fail('ERR_CONFLICT', result.written);
        if (item.expectedIdentity !== null && (!now
            || statIdentity(await lstat(now)) !== item.expectedIdentity
            || sha256((await readRegularFile(now)).bytes) !== item.expectedHash)) {
          fail('ERR_CONFLICT', result.written);
        }
        await writeAtomic(destination, item.entry.bytes, item.expectedIdentity, item.expectedHash, result.written, item.relative);
      }
      const manifestFile = path.join(target, MANIFEST_NAME);
      const manifestIdentity = oldManifest ? statIdentity(await lstat(manifestFile)) : null;
      const manifestHash = oldManifest ? sha256(oldManifest.bytes) : null;
      await writeAtomic(manifestFile, manifestBytes, manifestIdentity, manifestHash, result.written, MANIFEST_NAME);
      result.manifestDigest = sha256(manifestBytes);
      return result;
    } catch (error) {
      if (error instanceof InstallError) {
        error.written = result.written.slice();
        throw error;
      }
      fail('ERR_WRITE', result.written.slice());
    }
  });
}

export async function installStarter(options = {}) {
  try {
    return await installStarterInternal(options);
  } catch (error) {
    if (!(error instanceof InstallError)) {
      return {
        added: [],
        updated: [],
        preserved: [],
        conflicts: [],
        written: [],
        errorCode: 'ERR_INTERNAL',
      };
    }
    return {
      added: [],
      updated: [],
      preserved: [],
      conflicts: [],
      written: error.written ?? [],
      errorCode: error.code,
    };
  }
}

export function parseArguments(args) {
  const parsed = { source: undefined, project: undefined, apply: false, expectedManifestDigest: undefined };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!['--source', '--project', '--apply', '--baseline-manifest-sha256'].includes(flag) || seen.has(flag)) {
      fail('ERR_ARGS');
    }
    seen.add(flag);
    if (flag === '--apply') {
      parsed.apply = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) fail('ERR_ARGS');
    index += 1;
    if (flag === '--source') parsed.source = value;
    if (flag === '--project') parsed.project = value;
    if (flag === '--baseline-manifest-sha256') parsed.expectedManifestDigest = value;
  }
  if (!parsed.source || !parsed.project) fail('ERR_ARGS');
  if (parsed.expectedManifestDigest && !/^[a-f0-9]{64}$/.test(parsed.expectedManifestDigest)) fail('ERR_ARGS');
  return parsed;
}

export async function runCli(args = process.argv.slice(2), { studentUpdate = false } = {}) {
  try {
    const options = parseArguments(args);
    const result = await installStarter(options);
    if (result.errorCode) {
      if (studentUpdate) console.error(`멈춤: ${result.errorCode} · ${ERROR_MESSAGES[result.errorCode] ?? '작업을 완료하지 못했습니다.'}`);
      else console.error(result.errorCode);
      if (result.written.length) console.error(`written: ${result.written.join(', ')}`);
      return 1;
    }
    if (studentUpdate) {
      console.log(`${options.apply ? '적용 완료' : '미리보기'}: 새로 넣을 ${result.added.length}, 바꿀 ${result.updated.length}, 학생 파일로 보존 ${result.preserved.length}, 충돌 ${result.conflicts.length}`);
      for (const relative of result.preserved) console.log(`보존: ${relative}`);
      console.log(`새 기준 기록값: ${result.manifestDigest}`);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return 0;
  } catch (error) {
    const code = error instanceof InstallError ? error.code : 'ERR_INTERNAL';
    if (studentUpdate) console.error(`멈춤: ${code} · ${ERROR_MESSAGES[code] ?? '작업을 완료하지 못했습니다.'}`);
    else console.error(code);
    if (error?.written?.length) console.error(`written: ${error.written.join(', ')}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
