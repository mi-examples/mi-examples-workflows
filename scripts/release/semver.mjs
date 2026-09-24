// Minimal semver helpers for release versions and `-beta.N` prereleases.
// Build metadata (`+...`) is not used by our release flow and is rejected.

const SEMVER_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseVersion(text) {
  const match = SEMVER_RE.exec(String(text ?? '').trim());

  if (!match) return null;

  const [, major, minor, patch, prerelease] = match;

  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease: prerelease ?? null };
}

export function formatVersion({ major, minor, patch, prerelease }) {
  return `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}`;
}

// Bumps a release version. A breaking change on 0.x goes to 1.0.0, the same
// as semantic-release did.
export function bumpVersion(version, level) {
  const { major, minor, patch } = version;

  if (level === 'major') return { major: major + 1, minor: 0, patch: 0, prerelease: null };
  if (level === 'minor') return { major, minor: minor + 1, patch: 0, prerelease: null };
  if (level === 'patch') return { major, minor, patch: patch + 1, prerelease: null };

  throw new Error(`Unknown release level: ${level}`);
}

function compareIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);

  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;

  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }

  // A release sorts after all of its prereleases.
  if (!a.prerelease || !b.prerelease) return (a.prerelease ? -1 : 0) - (b.prerelease ? -1 : 0);

  const aIds = a.prerelease.split('.');
  const bIds = b.prerelease.split('.');

  for (let index = 0; index < Math.max(aIds.length, bIds.length); index += 1) {
    if (aIds[index] === undefined) return -1;
    if (bIds[index] === undefined) return 1;

    const result = compareIdentifiers(aIds[index], bIds[index]);

    if (result !== 0) return result;
  }

  return 0;
}
