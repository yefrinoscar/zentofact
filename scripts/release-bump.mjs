// Sets packages/web to the next version after origin/main.
// Usage: npm run release:bump -- patch|minor|major
import { execFileSync } from 'node:child_process';
import { bumpVersion } from './lib/release-type.mjs';

const kind = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: npm run release:bump -- patch|minor|major');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
git('fetch', '--quiet', 'origin', 'main');
const baseVersion = JSON.parse(git('show', 'origin/main:packages/web/package.json')).version;
const next = bumpVersion(baseVersion, `release:${kind}`);

// --ignore-scripts and --package-lock-only keep npm from reinstalling node_modules.
execFileSync(
  'npm',
  ['version', next, '-w', '@zentofact/web', '--no-git-tag-version', '--allow-same-version', '--ignore-scripts', '--package-lock-only'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
console.log(`release:${kind}: ${baseVersion} (origin/main) -> ${next}. Apply the release:${kind} label or check "${kind[0].toUpperCase()}${kind.slice(1)}" in the PR.`);
