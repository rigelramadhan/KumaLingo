// Run after setup-secret-checks.mjs: staged | push (hook stdin) | history | working-tree.
// Reports only rule, path, line and commit metadata; never scanner snippets/values.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, copyFile, mkdir, unlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const binary = resolve(root, '.tools/gitleaks/8.30.1', process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
const mode = process.argv[2];
if (!['staged', 'push', 'history', 'working-tree'].includes(mode)) throw new Error('Unknown scan mode.');
if (!existsSync(binary)) throw new Error('Run node scripts/setup-secret-checks.mjs before scanning.');
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Git inspection failed; publication blocked.');
  return result.stdout;
}
function checkPaths(paths) {
  for (const path of paths) {
    if (!path) continue;
    if (/(^|\/)(?:node_modules|\.tools|\.secrets|credentials|secrets|\.wrangler)\/|(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|web-config\.local\.json|wrangler\.local\.jsonc|config\.json)$|\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(path)) {
      throw new Error(`Private/local artifact in publication set: ${path}`);
    }
    if (process.env.KUMA_ALLOW_DOCUMENTS !== '1' && (/(^|\/)(?:docs|deployment)\/|\.(?:md|rst|adoc|example)$/i.test(path))) {
      throw new Error(`Document publication requires explicit authorization: ${path}`);
    }
  }
}
async function scan(command, extra, allowLocalConfig = false) {
  const report = resolve(root, '.tools', `scan-${randomUUID()}.json`);
  try {
    const result = spawnSync(binary, [command, ...extra, '--redact=100', '--no-banner', '--ignore-gitleaks-allow', '--report-format=json', `--report-path=${report}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.error || ![0, 1].includes(result.status)) throw new Error('Secret scanner failed; publication blocked.');
    const findings = existsSync(report) ? JSON.parse(await readFile(report, 'utf8')) : [];
    let rejected = 0;
    for (const finding of findings) {
      const path = finding.File.replaceAll('\\', '/').replace(/^.*\/snapshot\//, '');
      // This specific file is expected to contain browser config, but may never be published.
      if (allowLocalConfig && path === 'webBridge/web-config.local.json') {
        const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', path], { cwd: root });
        const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: root, stdio: 'ignore' });
        if (ignored.status === 0 && tracked.status === 1) continue;
      }
      console.error(JSON.stringify({ rule: finding.RuleID, file: path, line: finding.StartLine, commit: finding.Commit || undefined }));
      rejected += 1;
    }
    if (rejected || (result.status === 1 && findings.length === 0)) throw new Error('Secret findings block publication.');
  } finally {
    if (existsSync(report)) await unlink(report);
  }
}

if (mode === 'staged') {
  checkPaths(git(['diff', '--cached', '--name-only', '-z']).split('\0'));
  await scan('git', ['--staged', root]);
} else if (mode === 'history') {
  await scan('git', ['--log-opts=--all', root]);
} else if (mode === 'push') {
  const updates = readFileSync(0, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const zero = /^0+$/;
  for (const update of updates) {
    const [, localSha, , remoteSha] = update.split(/\s+/);
    if (!/^[a-f0-9]{40,64}$/i.test(localSha ?? '') || !/^[a-f0-9]{40,64}$/i.test(remoteSha ?? '')) throw new Error('Invalid push update.');
    if (zero.test(localSha)) continue;
    const range = zero.test(remoteSha) ? localSha : `${remoteSha}..${localSha}`;
    const commits = git(['rev-list', range]).trim().split(/\r?\n/).filter(Boolean);
    for (const commit of commits) checkPaths(git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', commit]).split('\0'));
    await scan('git', [`--log-opts=${range}`, root]);
  }
} else {
  // Include handwritten ignored/untracked files; omit Git internals and downloaded tools/dependencies.
  const temporary = await mkdtemp(join(tmpdir(), 'kumalingo-secret-scan-'));
  const snapshot = join(temporary, 'snapshot');
  async function copyTree(source) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (['.git', '.tools', 'node_modules'].includes(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new Error('Review symlinks before working-tree scanning.');
      const path = join(source, entry.name);
      if (entry.isDirectory()) await copyTree(path);
      else if (entry.isFile()) {
        const target = join(snapshot, relative(root, path));
        await mkdir(dirname(target), { recursive: true });
        await copyFile(path, target);
      }
    }
  }
  try {
    await copyTree(root);
    await scan('dir', [snapshot], true);
  } finally {
    // Verify the resolved target before recursive cleanup on Windows or Unix.
    const resolvedTemp = await realpath(temporary);
    const resolvedParent = await realpath(tmpdir());
    const child = relative(resolvedParent, resolvedTemp);
    if (!child.startsWith('kumalingo-secret-scan-') || child.includes('/') || child.includes('\\')) {
      throw new Error('Refusing cleanup outside the expected scanner temp directory.');
    }
    await rm(temporary, { recursive: true, force: true });
  }
}
console.log(`Secret check passed: ${mode} (redacted reporting).`);
