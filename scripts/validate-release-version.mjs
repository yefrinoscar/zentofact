import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const releaseLabels = new Set(['release:patch', 'release:minor', 'release:major']);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

function parseVersion(value, source) {
  const match = semverPattern.exec(value);
  if (!match) {
    throw new Error(`${source} must contain a stable X.Y.Z version; found ${JSON.stringify(value)}.`);
  }

  return match.slice(1).map(Number);
}

function versionFromGit(sha, file) {
  const contents = execFileSync('git', ['show', `${sha}:${file}`], { encoding: 'utf8' });
  return JSON.parse(contents).version;
}

function expectedVersion(baseVersion, releaseType) {
  const [major, minor, patch] = parseVersion(baseVersion, 'Base branch');

  if (releaseType === 'release:major') return `${major + 1}.0.0`;
  if (releaseType === 'release:minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

try {
  const baseSha = process.env.BASE_SHA;
  if (!baseSha) throw new Error('BASE_SHA is required.');

  const labels = JSON.parse(process.env.RELEASE_LABELS || '[]');
  const selectedLabels = labels.filter((label) => releaseLabels.has(label));
  if (selectedLabels.length !== 1) {
    throw new Error(
      `Apply exactly one release label (${[...releaseLabels].join(', ')}); found ${selectedLabels.length}.`,
    );
  }

  const releaseType = selectedLabels[0];
  const versionFile = 'packages/web/package.json';
  const lockfile = 'package-lock.json';
  const baseVersion = versionFromGit(baseSha, versionFile);
  const headVersion = JSON.parse(readFileSync(versionFile, 'utf8')).version;
  const lockVersion = JSON.parse(readFileSync(lockfile, 'utf8')).packages?.['packages/web']?.version;
  const expected = expectedVersion(baseVersion, releaseType);

  parseVersion(headVersion, 'Feature branch');

  if (headVersion !== expected) {
    fail(`${releaseType} requires ${baseVersion} -> ${expected}, but the pull request contains ${headVersion}.`);
  }

  if (lockVersion !== headVersion) {
    fail(`${lockfile} contains ${lockVersion || 'no web version'}; expected ${headVersion}.`);
  }

  const existingTag = execFileSync('git', ['tag', '--list', `v${headVersion}`], { encoding: 'utf8' }).trim();
  if (existingTag) {
    const existingTagSha = execFileSync('git', ['rev-list', '-n', '1', existingTag], { encoding: 'utf8' }).trim();
    const allowedSha = process.env.ALLOW_EXISTING_TAG_SHA;
    if (!allowedSha || existingTagSha !== allowedSha) {
      fail(`Version ${headVersion} already has tag ${existingTag} at ${existingTagSha}.`);
    }
  }

  if (!process.exitCode) {
    console.log(`Validated ${releaseType}: ${baseVersion} -> ${headVersion}.`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
