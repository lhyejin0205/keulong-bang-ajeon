import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installStarter, parseArguments } from '../tools/install.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'student-install-'));
const source = path.join(temp, 'starter');
const project = path.join(temp, 'project');
const target = path.join(project, 'on-client');

async function put(root, relative, contents) {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

async function expectCode(promise, code) {
  const result = await promise;
  assert.equal(result.errorCode, code);
}

try {
  await mkdir(source);
  await mkdir(project);
  await put(source, 'package.json', '{"name":"starter"}\n');
  await put(source, 'README.md', 'starter readme\n');
  await put(source, 'docs/STUDENT_PROMPTS.md', 'starter prompts\n');
  await put(source, 'docs/STUDENT_LAUNCH_GUIDE.md', 'student launch guide v1\n');
  await put(source, 'src/server.mjs', 'export const server = true;\n');
  await put(source, 'src/learning/private.mjs', 'must not copy\n');
  await put(source, 'student/extension.mjs', 'starter student file\n');
  await put(source, 'tools/app-credentials.ps1', 'helper-v1\n');
  const helperHash = hash(await readFile(path.join(source, 'tools/app-credentials.ps1')));
  await put(source, '.on-starter-manifest.json', JSON.stringify({
    version: 1,
    sourceHashes: { 'tools/app-credentials.ps1': helperHash },
  }));
  await put(source, '.env', 'must not copy\n');
  await put(source, 'public/.env.production', 'must not copy\n');
  await put(source, 'public/private-key.pem', 'must not copy\n');
  await put(source, 'public/test/fixture.mjs', 'must not copy\n');
  await put(source, 'src/node_modules/ignored/index.mjs', 'must not copy\n');
  await put(source, 'tools/other.mjs', 'must not copy\n');

  const preview = await installStarter({ source, project });
  assert.equal(preview.errorCode, undefined);
  assert.equal(preview.added.length, 7);
  assert.equal(preview.updated.length, 0);
  assert.equal(preview.preserved.length, 0);
  assert.equal(await readFile(path.join(project, 'on-client', 'README.md')).then(() => true).catch(() => false), false);

  const applied = await installStarter({ source, project, apply: true });
  assert.equal(applied.errorCode, undefined);
  assert.equal(applied.added.length, 7);
  assert.equal(applied.manifestDigest, preview.manifestDigest);
  assert.equal((await readFile(path.join(target, 'src/server.mjs'), 'utf8')).includes('server = true'), true);
  await assert.rejects(readFile(path.join(target, 'src/learning/private.mjs')));
  await assert.rejects(readFile(path.join(target, '.env')));
  await assert.rejects(readFile(path.join(target, 'public/.env.production')));
  await assert.rejects(readFile(path.join(target, 'public/private-key.pem')));
  await assert.rejects(readFile(path.join(target, 'public/test/fixture.mjs')));
  await assert.rejects(readFile(path.join(target, 'src/node_modules/ignored/index.mjs')));
  await assert.rejects(readFile(path.join(target, 'tools/other.mjs')));
  assert.equal(hash(await readFile(path.join(target, 'tools/app-credentials.ps1'))), helperHash);
  assert.equal(await readFile(path.join(target, 'docs/STUDENT_LAUNCH_GUIDE.md'), 'utf8'), 'student launch guide v1\n');
  const studentPreview = spawnSync(process.execPath, [
    path.join(testDirectory, '..', 'tools', 'student-update.mjs'),
    '--source', source,
    '--project', project,
    '--baseline-manifest-sha256', applied.manifestDigest,
  ], { encoding: 'utf8' });
  assert.equal(studentPreview.status, 0, studentPreview.stderr);
  assert.match(studentPreview.stdout, /미리보기:/);

  await put(target, 'student/extension.mjs', 'student work\n');
  await put(target, 'README.md', 'student edit\n');
  const updateSource = 'updated starter readme\n';
  await put(source, 'README.md', updateSource);
  await put(source, 'docs/STUDENT_LAUNCH_GUIDE.md', 'student launch guide v2\n');
  await put(source, 'tools/app-credentials.ps1', 'helper-v2\n');
  const nextHelperHash = hash(await readFile(path.join(source, 'tools/app-credentials.ps1')));
  await put(source, '.on-starter-manifest.json', JSON.stringify({
    version: 1,
    sourceHashes: { 'tools/app-credentials.ps1': nextHelperHash },
  }));
  const updatePreview = await installStarter({
    source,
    project,
    expectedManifestDigest: applied.manifestDigest,
  });
  assert.deepEqual(updatePreview.updated, ['docs/STUDENT_LAUNCH_GUIDE.md', 'tools/app-credentials.ps1']);
  assert.ok(updatePreview.preserved.includes('README.md'));
  assert.ok(updatePreview.updated.includes('docs/STUDENT_LAUNCH_GUIDE.md'));
  assert.ok(updatePreview.preserved.includes('student/extension.mjs'));
  assert.ok(updatePreview.updated.includes('tools/app-credentials.ps1'));
  await expectCode(installStarter({ source, project }), 'ERR_BASELINE_REQUIRED');
  await expectCode(installStarter({
    source,
    project,
    expectedManifestDigest: '0'.repeat(64),
  }), 'ERR_BASELINE_MISMATCH');
  assert.equal(await readFile(path.join(target, 'README.md'), 'utf8'), 'student edit\n');
  const updatedApplied = await installStarter({
    source,
    project,
    expectedManifestDigest: applied.manifestDigest,
    apply: true,
  });
  assert.equal(updatedApplied.errorCode, undefined);
  assert.ok(updatedApplied.written.includes('tools/app-credentials.ps1'));
  assert.equal(await readFile(path.join(target, 'tools/app-credentials.ps1'), 'utf8'), 'helper-v2\n');
  await put(target, 'README.md', 'starter readme\n');
  const refreshed = await installStarter({
    source,
    project,
    expectedManifestDigest: updatedApplied.manifestDigest,
  });
  assert.ok(refreshed.updated.includes('README.md'));
  const readmeApplied = await installStarter({
    source,
    project,
    expectedManifestDigest: updatedApplied.manifestDigest,
    apply: true,
  });
  assert.equal(readmeApplied.errorCode, undefined);
  assert.equal(await readFile(path.join(target, 'README.md'), 'utf8'), updateSource);
  assert.equal(await readFile(path.join(target, 'docs/STUDENT_LAUNCH_GUIDE.md'), 'utf8'), 'student launch guide v2\n');
  assert.ok(readmeApplied.written.includes('README.md'));

  assert.throws(() => parseArguments(['--source', 'x', '--project', 'y', '--unknown']), (error) => error.code === 'ERR_ARGS');
  assert.throws(() => parseArguments(['--source', 'x', '--project']), (error) => error.code === 'ERR_ARGS');
  const badCli = spawnSync(process.execPath, [
    path.join(testDirectory, '..', 'tools', 'install.mjs'),
    '--source', source, '--project', project, '--unknown',
  ], { encoding: 'utf8' });
  assert.equal(badCli.status, 1);
  assert.match(badCli.stderr, /^ERR_ARGS\s*$/);

  const badSource = path.join(temp, 'bad-helper');
  const otherProject = path.join(temp, 'other-project');
  await mkdir(badSource);
  await mkdir(otherProject);
  await put(badSource, 'tools/app-credentials.ps1', 'unverified\n');
  await expectCode(installStarter({ source: badSource, project: otherProject }), 'ERR_HELPER_SOURCE_UNVERIFIABLE');
  await expectCode(installStarter({ source, project: source }), 'ERR_SAME_PATH');
  await expectCode(installStarter({ source, project: temp }), 'ERR_NESTED');
  await mkdir(path.join(otherProject, 'on-client'));
  await expectCode(installStarter({ source, project: otherProject }), 'ERR_UNVERIFIABLE');

  const busyProject = path.join(temp, 'busy-project');
  await mkdir(busyProject);
  await writeFile(path.join(busyProject, '.on-client.install.lock'), 'another process\n');
  const busyResult = await installStarter({ source, project: busyProject, apply: true });
  assert.equal(busyResult.errorCode, 'ERR_INSTALL_BUSY');
  await assert.rejects(readFile(path.join(busyProject, 'on-client')));

  const linkedSource = path.join(temp, 'linked-source');
  const linkedProject = path.join(temp, 'linked-project');
  await mkdir(linkedSource);
  await mkdir(linkedProject);
  await put(linkedSource, 'src/server.mjs', 'shared\n');
  await link(
    path.join(linkedSource, 'src/server.mjs'),
    path.join(linkedSource, 'src/linked.mjs'),
  );
  await expectCode(installStarter({ source: linkedSource, project: linkedProject }), 'ERR_HARDLINK');
  assert.throws(() => parseArguments(['--source', 'C:\\starter', '--project', 'C:\\project', '--baseline-manifest-sha256', 'not-a-digest']), (error) => error.code === 'ERR_ARGS');

  console.log('student-launch checks passed');
} finally {
  await rm(temp, { recursive: true, force: true });
}
