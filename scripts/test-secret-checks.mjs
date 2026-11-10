// Isolated local Git fixture only; never contacts or updates a remote repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixture = await mkdtemp(join(root, '.tools', 'hook-test-'));
await mkdir(join(fixture, 'scripts'), { recursive: true });
await mkdir(join(fixture, '.githooks'), { recursive: true });
await mkdir(join(fixture, '.tools/gitleaks/8.30.1'), { recursive: true });
for (const file of ['scripts/check-secrets.mjs', '.gitleaks.toml', '.githooks/pre-commit', '.githooks/pre-push']) {
  await copyFile(join(root, file), join(fixture, file));
}
const binary = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
await copyFile(join(root, '.tools/gitleaks/8.30.1', binary), join(fixture, '.tools/gitleaks/8.30.1', binary));
function git(args, input) {
  const result = spawnSync('git', args, { cwd: fixture, encoding: 'utf8', input });
  if (result.error) throw new Error('Isolated Git fixture execution failed.');
  return result;
}
function ok(args, input) {
  const result = git(args, input);
  assert.equal(result.status, 0, 'Fixture setup failed.');
  return result.stdout.trim();
}
ok(['init', '--quiet']);
ok(['config', 'user.name', 'Secret Check Test']);
ok(['config', 'user.email', 'test@example.invalid']);
ok(['config', 'core.hooksPath', '.githooks']);
const synthetic = 'AIza' + 'A'.repeat(35);
await writeFile(join(fixture, 'fixture.js'), `export const key = '${synthetic}';\n`);
ok(['add', 'fixture.js']);
const rejected = git(['commit', '--quiet', '-m', 'synthetic scanner fixture']);
assert.notEqual(rejected.status, 0, 'Pre-commit must reject a secret-shaped fixture.');
assert.match(rejected.stderr, /Secret findings block publication/);
assert.ok(!rejected.stderr.includes(synthetic), 'Hook output must not disclose the finding.');
await writeFile(join(fixture, 'fixture.js'), 'export const config = "PLACEHOLDER";\n');
ok(['add', 'fixture.js']);
ok(['commit', '--quiet', '-m', 'safe fixture']);
const safeCommit = ok(['rev-parse', 'HEAD']);

await writeFile(join(fixture, 'NOTES.md'), 'Local-only document.\n');
ok(['add', 'NOTES.md']);
const rejectedDocs = git(['commit', '--quiet', '-m', 'document fixture']);
assert.notEqual(rejectedDocs.status, 0, 'Pre-commit must reject unauthorized documentation.');
assert.match(rejectedDocs.stderr, /Document publication requires explicit authorization/);
ok(['reset', '--mixed', '--quiet', 'HEAD']);

// Create a detached synthetic commit object to test outgoing-history scanning.
// This never bypasses protection on the real repository or publishes the fixture.
const blob = ok(['hash-object', '-w', '--stdin'], `export const key = '${synthetic}';\n`);
const tree = ok(['mktree'], `100644 blob ${blob}\tfixture.js\n`);
const unsafeCommit = ok(['commit-tree', tree, '-p', safeCommit], 'synthetic detached fixture\n');
function pushCheck(commit) {
  return spawnSync(process.execPath, ['scripts/check-secrets.mjs', 'push'], {
    cwd: fixture, encoding: 'utf8',
    input: `refs/heads/main ${commit} refs/heads/main ${safeCommit}\n`,
  });
}
const outgoing = pushCheck(unsafeCommit);
assert.notEqual(outgoing.status, 0, 'Pre-push scanner must reject an outgoing secret commit.');
assert.match(outgoing.stderr, /Secret findings block publication/);
assert.ok(!outgoing.stderr.includes(synthetic), 'Pre-push output must redact the finding.');
assert.equal(pushCheck(safeCommit).status, 0, 'Clean outgoing history should pass.');
console.log('PASS: installed pre-commit hook rejects synthetic secrets/documents; outgoing scan rejects secret history; safe cases pass; output stays redacted.');
