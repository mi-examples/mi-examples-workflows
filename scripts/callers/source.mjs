// Where the caller templates come from: a released tag of this repository,
// pinned by the commit SHA it points to, so the installer and drift sync
// always write the templates of the exact version they pin.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compareVersions, parseVersion } from '../release/semver.mjs';
import { CALLERS } from './render.mjs';

export const REPOSITORY = 'mi-examples/mi-examples-workflows';
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}.git`;

// Parses `git ls-remote --tags` output into { version → commit sha }.
// Annotated tags appear twice; the peeled `^{}` line is the commit.
export function parseTagRefs(output) {
  const tags = new Map();

  for (const line of output.split('\n')) {
    const match = /^([0-9a-f]{40})\trefs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/.exec(line.trim());

    if (!match) continue;

    const [, sha, tag, peeled] = match;

    if (peeled || !tags.has(tag)) tags.set(tag, sha);
  }

  return tags;
}

// The requested release (e.g. "v0.5.0") or the highest one. Only stable
// vX.Y.Z tags count.
export function pickRelease(tags, requested) {
  if (requested) {
    const version = requested.startsWith('v') ? requested : `v${requested}`;

    if (!tags.has(version)) throw new Error(`${REPOSITORY} has no release ${version}`);

    return { version, sha: tags.get(version) };
  }

  const [latest] = [...tags.keys()].sort((a, b) => compareVersions(parseVersion(b), parseVersion(a)));

  if (!latest) throw new Error(`${REPOSITORY} has no releases yet`);

  return { version: latest, sha: tags.get(latest) };
}

export function resolveRelease({ requested, url = REPOSITORY_URL } = {}) {
  const output = execFileSync('git', ['ls-remote', '--tags', '--end-of-options', url], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return pickRelease(parseTagRefs(output), requested);
}

export function loadTemplatesFromDir(dir) {
  return Object.fromEntries(Object.entries(CALLERS).map(([name, file]) => [name, readFileSync(join(dir, file), 'utf8')]));
}

export async function loadTemplatesAt(sha, { fetchImpl = fetch } = {}) {
  const entries = await Promise.all(
    Object.entries(CALLERS).map(async ([name, file]) => {
      const url = `https://raw.githubusercontent.com/${REPOSITORY}/${sha}/templates/${file}`;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });

      if (!response.ok) throw new Error(`could not download ${file} for ${sha}: ${response.status}`);

      return [name, await response.text()];
    }),
  );

  return Object.fromEntries(entries);
}
