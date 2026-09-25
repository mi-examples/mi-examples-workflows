// Next production and beta versions, computed from tags and conventional
// commits. Needs the full history and all tags (checkout with fetch-depth: 0).

import { parseCommit, releaseLevel } from './commits.mjs';
import { listTags, readCommits, readFileAt, tagsPointingAt } from './git.mjs';
import { bumpVersion, compareVersions, formatVersion, parseVersion } from './semver.mjs';

function versionTags(tags) {
  return tags
    .map((tag) => ({ tag, version: parseVersion(tag) }))
    .filter(({ tag, version }) => tag.startsWith('v') && version)
    .sort((a, b) => compareVersions(b.version, a.version));
}

function newestRelease(tags) {
  return versionTags(tags).find(({ version }) => !version.prerelease) ?? null;
}

// Newest production tag (vX.Y.Z) reachable from `ref`.
export function lastRelease({ cwd, ref = 'HEAD' } = {}) {
  return newestRelease(listTags(cwd, { mergedInto: ref }));
}

// State of the package.json version on `ref`, used by the release on main:
//   prerelease  package.json holds a prerelease, so there is nothing to release
//   released    the version's tag already exists
//   new         no tag yet, and newer than the last release (or the first one)
//   stale       no tag, but not newer than the last release
export function releaseStatus({ cwd, ref = 'HEAD' } = {}) {
  const raw = JSON.parse(readFileAt(ref, 'package.json', cwd)).version;
  const parsed = parseVersion(raw);

  if (!parsed) throw new Error(`package.json on ${ref} has an invalid version: ${raw}`);

  const version = formatVersion(parsed);
  const tag = `v${version}`;
  const tagExists = listTags(cwd).includes(tag);
  const last = lastRelease({ cwd, ref });
  let state;

  if (parsed.prerelease) state = 'prerelease';
  else if (tagExists) state = 'released';
  else if (!last || compareVersions(parsed, last.version) > 0) state = 'new';
  else state = 'stale';

  return { version, tag, tagExists, lastTag: last?.tag ?? null, state };
}

export function nextVersion({ cwd, ref = 'HEAD' } = {}) {
  const last = lastRelease({ cwd, ref });

  if (!last) {
    throw new Error(
      `No production tag (vX.Y.Z) is reachable from ${ref}. ` +
        'Tag the commit of the last published version first, e.g. `git tag v1.2.3 <sha>`.',
    );
  }

  const commits = readCommits(`${last.tag}..${ref}`, cwd).map(parseCommit);
  const level = releaseLevel(commits);

  if (!level) return { version: null, level: null, lastTag: last.tag, commits };

  const version = bumpVersion(last.version, level);
  const newest = newestRelease(listTags(cwd));

  // A newer release exists that this branch doesn't contain, e.g. main was
  // released but never merged back into develop. Computing from the stale
  // baseline would produce a version that's already behind.
  if (newest && compareVersions(version, newest.version) <= 0) {
    throw new Error(
      `${newest.tag} exists but is not reachable from ${ref}, so the next version would be ` +
        `v${formatVersion(version)}. Merge the released branch (usually main) into this branch first.`,
    );
  }

  return { version: formatVersion(version), level, lastTag: last.tag, commits };
}

export function nextBeta({ cwd, ref = 'HEAD' } = {}) {
  const next = nextVersion({ cwd, ref });
  const previousTag = versionTags(listTags(cwd, { mergedInto: ref }))[0]?.tag ?? null;

  if (!next.version) return { ...next, baseVersion: null, previousTag, alreadyTagged: false };

  const prefix = `v${next.version}-beta.`;
  const betaNumbers = (tags) =>
    tags
      .filter((tag) => tag.startsWith(prefix) && /^\d+$/.test(tag.slice(prefix.length)))
      .map((tag) => Number(tag.slice(prefix.length)));

  // Re-running on a commit that already has its beta tag returns that beta,
  // so a failed publish can be retried without burning a number.
  const atRef = betaNumbers(tagsPointingAt(ref, cwd));

  if (atRef.length > 0) {
    const number = Math.max(...atRef);
    const ownTag = `${prefix}${number}`;
    const previous = versionTags(listTags(cwd, { mergedInto: ref })).find(({ tag }) => tag !== ownTag)?.tag ?? null;

    return {
      ...next,
      version: `${next.version}-beta.${number}`,
      baseVersion: next.version,
      previousTag: previous,
      alreadyTagged: true,
    };
  }

  // The level is computed from every commit since the last production
  // release, but a new beta also needs something releasable since the
  // previous beta. Otherwise every push after one `fix` (docs, ci, ...)
  // would publish another identical beta.
  if (previousTag && parseVersion(previousTag).prerelease) {
    const sinceBeta = readCommits(`${previousTag}..${ref}`, cwd).map(parseCommit);

    if (!releaseLevel(sinceBeta)) {
      return { ...next, version: null, level: null, baseVersion: null, previousTag, alreadyTagged: false };
    }
  }

  const existing = betaNumbers(listTags(cwd));
  const number = existing.length > 0 ? Math.max(...existing) + 1 : 1;

  return {
    ...next,
    version: `${next.version}-beta.${number}`,
    baseVersion: next.version,
    previousTag,
    alreadyTagged: false,
  };
}
