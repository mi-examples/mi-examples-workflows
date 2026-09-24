import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bumpVersion, compareVersions, formatVersion, parseVersion } from './semver.mjs';

describe('parseVersion', () => {
  it('parses releases and prereleases, with or without a leading v', () => {
    assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: null });
    assert.deepEqual(parseVersion('1.2.3-beta.4'), { major: 1, minor: 2, patch: 3, prerelease: 'beta.4' });
  });

  it('rejects anything that is not a plain semver', () => {
    for (const text of ['1.2', '01.2.3', '1.2.3+build.1', 'v1.2.3-', 'release-1.2.3', '', null]) {
      assert.equal(parseVersion(text), null, String(text));
    }
  });
});

describe('bumpVersion', () => {
  const base = parseVersion('1.2.3');

  it('bumps each level and resets the lower ones', () => {
    assert.equal(formatVersion(bumpVersion(base, 'major')), '2.0.0');
    assert.equal(formatVersion(bumpVersion(base, 'minor')), '1.3.0');
    assert.equal(formatVersion(bumpVersion(base, 'patch')), '1.2.4');
  });

  it('moves 0.x to 1.0.0 on a breaking change', () => {
    assert.equal(formatVersion(bumpVersion(parseVersion('0.11.0'), 'major')), '1.0.0');
  });

  it('rejects an unknown level', () => {
    assert.throws(() => bumpVersion(base, 'huge'), /Unknown release level/);
  });
});

describe('compareVersions', () => {
  it('orders releases, prereleases and numeric identifiers', () => {
    const sorted = ['1.0.0', '1.0.0-beta.10', '0.9.9', '1.0.0-beta.2', '1.0.1', '1.0.0-beta.2.1']
      .map(parseVersion)
      .sort(compareVersions)
      .map(formatVersion);

    assert.deepEqual(sorted, ['0.9.9', '1.0.0-beta.2', '1.0.0-beta.2.1', '1.0.0-beta.10', '1.0.0', '1.0.1']);
  });
});
