export const releaseLabels = ['release:patch', 'release:minor', 'release:major'];

const checkboxLabels = {
  patch: 'release:patch',
  minor: 'release:minor',
  major: 'release:major',
};

// Reads the "Release type" checkboxes from the pull request template.
export function releaseLabelsFromBody(body) {
  const found = new Set();
  for (const match of String(body || '').matchAll(/^\s*[-*]\s*\[[xX]\]\s*(Patch|Minor|Major)\b/gm)) {
    found.add(checkboxLabels[match[1].toLowerCase()]);
  }
  return [...found];
}

// Labels win when present; otherwise the checked template box decides.
export function resolveReleaseType({ labels = [], body = '' }) {
  const fromLabels = labels.filter((label) => releaseLabels.includes(label));
  const fromBody = releaseLabelsFromBody(body);

  if (fromLabels.length > 1) {
    throw new Error(`Apply only one release label; found ${fromLabels.join(', ')}.`);
  }
  if (fromLabels.length === 1) {
    if (fromBody.length === 1 && fromBody[0] !== fromLabels[0]) {
      throw new Error(
        `The ${fromLabels[0]} label does not match the "${fromBody[0]}" release type checked in the description.`,
      );
    }
    return { releaseType: fromLabels[0], source: 'label' };
  }
  if (fromBody.length === 1) return { releaseType: fromBody[0], source: 'description' };

  throw new Error(
    fromBody.length > 1
      ? `Check only one release type in the description; found ${fromBody.join(', ')}.`
      : `Check one release type (Patch, Minor, Major) in the description or apply one label (${releaseLabels.join(', ')}).`,
  );
}

export function bumpVersion(baseVersion, releaseType) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(baseVersion);
  if (!match) throw new Error(`Base version must be a stable X.Y.Z version; found ${JSON.stringify(baseVersion)}.`);
  const [major, minor, patch] = match.slice(1).map(Number);

  if (releaseType === 'release:major') return `${major + 1}.0.0`;
  if (releaseType === 'release:minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
