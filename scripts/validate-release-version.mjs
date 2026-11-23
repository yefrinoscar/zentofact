import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { bumpVersion, resolveReleaseType } from './lib/release-type.mjs';

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

function versionFromGit(sha, file) {
  const contents = execFileSync('git', ['show', `${sha}:${file}`], { encoding: 'utf8' });
  return JSON.parse(contents).version;
}

try {
  const baseSha = process.env.BASE_SHA;
  if (!baseSha) throw new Error('BASE_SHA is required.');

  const { releaseType, source } = resolveReleaseType({
    labels: JSON.parse(process.env.RELEASE_LABELS || '[]'),
    body: process.env.PR_BODY || '',
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `release_type=${releaseType}\nsource=${source}\n`);
  }

  const versionFile = 'packages/web/package.json';
  const lockfile = 'package-lock.json';
  const baseVersion = versionFromGit(baseSha, versionFile);
  const headVersion = JSON.parse(readFileSync(versionFile, 'utf8')).version;
  const lockVersion = JSON.parse(readFileSync(lockfile, 'utf8')).packages?.['packages/web']?.version;
  const expected = bumpVersion(baseVersion, releaseType);

  if (!semverPattern.test(headVersion)) {
    throw new Error(`Feature branch must contain a stable X.Y.Z version; found ${JSON.stringify(headVersion)}.`);
  }

  if (headVersion !== expected) {
    const kind = releaseType.replace('release:', '');
    fail(
      `${releaseType} requires ${baseVersion} -> ${expected}, but the pull request contains ${headVersion}. ` +
        `Run \`npm run release:bump -- ${kind}\`, commit, and push.`,
    );
  }

  if (lockVersion !== headVersion) {
    fail(`${lockfile} contains ${lockVersion || 'no web version'}; expected ${headVersion}. Run \`npm run release:bump\`.`);
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
    console.log(`Validated ${releaseType} (from ${source}): ${baseVersion} -> ${headVersion}.`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
