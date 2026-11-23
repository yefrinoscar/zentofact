// Rewrites packages/web (and its package-lock entry) to the version the pull
// request's release type requires, computed from the latest base branch.
// CI runs this before validation so nobody has to remember `release:bump`.
//
// Env: PR_BODY, RELEASE_LABELS (JSON array), BASE_REF (default "main").
// Writes `changed`, `version`, `release_type` to GITHUB_OUTPUT when present.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolveReleaseType } from './lib/release-type.mjs';
import { planReleaseVersion } from './lib/release-sync.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

const baseRef = process.env.BASE_REF || 'main';
const { releaseType } = resolveReleaseType({
  labels: JSON.parse(process.env.RELEASE_LABELS || '[]'),
  body: process.env.PR_BODY || '',
});

git('fetch', '--quiet', 'origin', baseRef);
const baseVersion = JSON.parse(git('show', `origin/${baseRef}:packages/web/package.json`)).version;
const headVersion = JSON.parse(readFileSync('packages/web/package.json', 'utf8')).version;
const lockVersion = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages?.['packages/web']?.version;
const { expected, needsBump } = planReleaseVersion({ baseVersion, headVersion, lockVersion, releaseType });

if (needsBump) {
  // --ignore-scripts and --package-lock-only keep npm from reinstalling node_modules.
  execFileSync(
    'npm',
    ['version', expected, '-w', '@zentofact/web', '--no-git-tag-version', '--allow-same-version', '--ignore-scripts', '--package-lock-only'],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  console.log(`${releaseType}: ${headVersion} -> ${expected} (origin/${baseRef} is ${baseVersion}).`);
} else {
  console.log(`${releaseType}: ${headVersion} already matches origin/${baseRef} ${baseVersion}.`);
}
output({ changed: String(needsBump), version: expected, release_type: releaseType });
