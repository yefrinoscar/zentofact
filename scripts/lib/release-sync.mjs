import { bumpVersion } from './release-type.mjs';

// Decides whether a pull request branch needs its version rewritten so it is
// exactly one release step above the base branch.
export function planReleaseVersion({ baseVersion, headVersion, lockVersion, releaseType }) {
  const expected = bumpVersion(baseVersion, releaseType);
  return {
    expected,
    needsBump: headVersion !== expected || lockVersion !== expected,
  };
}
