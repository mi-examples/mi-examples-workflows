import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createRepo } from './fixtures.mjs';
import { lastRelease, nextBeta, nextVersion, releaseStatus } from './versions.mjs';

let repo;

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.cleanup();
});

describe('lastRelease', () => {
  it('returns the highest reachable production tag and ignores betas and foreign tags', () => {
    repo.commit('feat: one');
    repo.tag('v1.9.0');
    repo.commit('feat: two');
    repo.tag('v1.10.0');
    repo.tag('v1.11.0-beta.1');
    repo.tag('vendor-1');

    assert.equal(lastRelease({ cwd: repo.dir }).tag, 'v1.10.0');
  });

  it('returns null without a production tag', () => {
    repo.commit('feat: one');
    repo.tag('v1.0.0-beta.1');

    assert.equal(lastRelease({ cwd: repo.dir }), null);
  });
});

describe('nextVersion', () => {
  it('bumps from the last production tag using only newer commits', () => {
    repo.commit('feat!: old breaking change');
    repo.tag('v1.2.0');
    repo.commit('fix: a');
    repo.commit('docs: b');

    const result = nextVersion({ cwd: repo.dir });

    assert.equal(result.version, '1.2.1');
    assert.equal(result.level, 'patch');
    assert.equal(result.lastTag, 'v1.2.0');
    assert.equal(result.commits.length, 2);
  });

  it('reports no release when nothing is releasable', () => {
    repo.commit('feat: a');
    repo.tag('v1.2.0');
    repo.commit('chore: b');

    assert.equal(nextVersion({ cwd: repo.dir }).version, null);
  });

  it('ignores merge commits but counts the commits they bring in', () => {
    repo.commit('chore: init');
    repo.tag('v1.0.0');
    repo.git('switch', '-q', '-c', 'feature');
    repo.commit('feat: on a branch');
    repo.git('switch', '-q', 'main');
    repo.git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge branch feature');

    assert.equal(nextVersion({ cwd: repo.dir }).version, '1.1.0');
  });

  it('fails without a production tag', () => {
    repo.commit('feat: a');

    assert.throws(() => nextVersion({ cwd: repo.dir }), /No production tag/);
  });

  it('fails when a newer release is not merged back (stale baseline)', () => {
    repo.commit('chore: init');
    repo.tag('v1.3.0');
    repo.git('switch', '-q', '-c', 'develop');
    repo.git('switch', '-q', 'main');
    repo.commit('feat: released from main');
    repo.tag('v1.4.0');
    repo.git('switch', '-q', 'develop');
    repo.commit('feat: new work');

    assert.throws(() => nextVersion({ cwd: repo.dir }), /v1\.4\.0 exists but is not reachable/);

    repo.git('merge', '-q', '--no-ff', 'main', '-m', 'Merge main into develop');

    assert.equal(nextVersion({ cwd: repo.dir }).version, '1.5.0');
  });
});

describe('releaseStatus', () => {
  const setVersion = (version) => {
    writeFileSync(join(repo.dir, 'package.json'), JSON.stringify({ name: 'pkg', version }));
    repo.git('add', 'package.json');
    repo.commit(`chore(release): ${version}`);
  };

  it('reports a new version, then released once tagged', () => {
    setVersion('1.2.0');
    repo.tag('v1.2.0');
    setVersion('1.3.0');

    assert.deepEqual(releaseStatus({ cwd: repo.dir }), {
      version: '1.3.0',
      tag: 'v1.3.0',
      tagExists: false,
      lastTag: 'v1.2.0',
      state: 'new',
    });

    repo.tag('v1.3.0');

    assert.equal(releaseStatus({ cwd: repo.dir }).state, 'released');
  });

  it('treats the first release without any tag as new', () => {
    setVersion('0.1.0');

    assert.equal(releaseStatus({ cwd: repo.dir }).state, 'new');
  });

  it('reports prereleases and stale versions', () => {
    setVersion('1.2.0');
    repo.tag('v1.2.0');
    setVersion('1.3.0-beta.1');

    assert.equal(releaseStatus({ cwd: repo.dir }).state, 'prerelease');

    setVersion('1.1.9');

    assert.equal(releaseStatus({ cwd: repo.dir }).state, 'stale');
  });

  it('rejects an invalid version', () => {
    setVersion('latest');

    assert.throws(() => releaseStatus({ cwd: repo.dir }), /invalid version: latest/);
  });
});

describe('nextBeta', () => {
  it('starts at beta.1 and continues from the highest existing beta tag', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('feat: a');

    const first = nextBeta({ cwd: repo.dir });

    assert.equal(first.version, '1.3.0-beta.1');
    assert.equal(first.baseVersion, '1.3.0');
    assert.equal(first.previousTag, 'v1.2.0');
    assert.equal(first.alreadyTagged, false);

    repo.tag('v1.3.0-beta.1');
    repo.commit('fix: b');

    const second = nextBeta({ cwd: repo.dir });

    assert.equal(second.version, '1.3.0-beta.2');
    assert.equal(second.previousTag, 'v1.3.0-beta.1');
  });

  it('publishes no new beta when nothing releasable landed since the previous beta', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('fix: a');
    repo.tag('v1.2.1-beta.1');
    repo.commit('ci: pin workflows');
    repo.commit('docs: readme');

    const quiet = nextBeta({ cwd: repo.dir });

    assert.equal(quiet.version, null);
    assert.equal(quiet.previousTag, 'v1.2.1-beta.1');

    repo.commit('fix: b');

    assert.equal(nextBeta({ cwd: repo.dir }).version, '1.2.1-beta.2');
  });

  it('numbers after beta tags on other branches too', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.git('switch', '-q', '-c', 'other');
    repo.commit('feat: elsewhere');
    repo.tag('v1.3.0-beta.4');
    repo.git('switch', '-q', 'main');
    repo.commit('feat: here');

    assert.equal(nextBeta({ cwd: repo.dir }).version, '1.3.0-beta.5');
  });

  it('returns the existing beta when HEAD is already tagged', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('feat: a');
    repo.tag('v1.3.0-beta.1');
    repo.commit('fix: b');
    repo.tag('v1.3.0-beta.2');

    const result = nextBeta({ cwd: repo.dir });

    assert.equal(result.version, '1.3.0-beta.2');
    assert.equal(result.alreadyTagged, true);
    assert.equal(result.previousTag, 'v1.3.0-beta.1');
  });

  it('jumps to the new base version when the level grows', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('fix: a');
    repo.tag('v1.2.1-beta.1');
    repo.commit('feat: b');

    assert.equal(nextBeta({ cwd: repo.dir }).version, '1.3.0-beta.1');
  });

  it('reports no release when nothing is releasable', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('docs: a');

    const result = nextBeta({ cwd: repo.dir });

    assert.equal(result.version, null);
    assert.equal(result.baseVersion, null);
  });
});
