// Run: node scripts/setup-secret-checks.mjs (requires Node 20+, Git and tar).
// Downloads the pinned official release, verifies its checksum, installs hooks.
// CI uses --no-hooks. No credentials are required for public release downloads.
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const scannerVersion = '8.30.1';
const platform = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[process.platform];
if (!platform || !['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported scanner platform.');
const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, '.tools', 'gitleaks', scannerVersion);
const binary = resolve(directory, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
const archive = `gitleaks_${scannerVersion}_${platform}_${process.arch}.${extension}`;
const base = `https://github.com/gitleaks/gitleaks/releases/download/v${scannerVersion}`;

async function download(name) {
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`Official scanner download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Setup command failed: ${command}`);
  return result.stdout.trim();
}

await mkdir(directory, { recursive: true });
// Verify the archive on every setup invocation, including existing installations.
const [archiveBytes, checksums] = await Promise.all([
  download(archive), download(`gitleaks_${scannerVersion}_checksums.txt`),
]);
const expected = checksums.toString('utf8').split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/)).find((parts) => parts[1] === archive)?.[0];
const actual = createHash('sha256').update(archiveBytes).digest('hex');
if (!expected || expected !== actual) throw new Error('Scanner archive checksum mismatch.');
const archivePath = resolve(directory, archive);
await writeFile(archivePath, archiveBytes);
run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archivePath, '-C', directory]);
if (process.platform !== 'win32') await chmod(binary, 0o755);
if (run(binary, ['version']) !== scannerVersion) throw new Error('Installed scanner version mismatch.');

if (!process.argv.includes('--no-hooks')) {
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
  if (configured.error || ![0, 1].includes(configured.status)) throw new Error('Cannot inspect Git hooks configuration.');
  const current = configured.stdout.trim();
  if (current && current !== '.githooks') throw new Error('Existing custom hooks need integration before installation.');
  if (!current) {
    const gitDirectory = run('git', ['rev-parse', '--git-path', 'hooks']);
    for (const hook of ['pre-commit', 'pre-push']) {
      if (existsSync(resolve(root, gitDirectory, hook))) throw new Error('Existing Git hook needs integration before installation.');
    }
  }
  for (const hook of ['pre-commit', 'pre-push']) {
    const path = resolve(root, '.githooks', hook);
    if (!(await readFile(path, 'utf8')).startsWith('#!/bin/sh')) throw new Error('Missing hook entry point.');
    if (process.platform !== 'win32') await chmod(path, 0o755);
  }
  run('git', ['config', '--local', 'core.hooksPath', '.githooks']);
  console.log(`Gitleaks ${scannerVersion}: checksum verified; pre-commit/pre-push hooks installed.`);
} else {
  console.log(`Gitleaks ${scannerVersion}: checksum verified.`);
}
