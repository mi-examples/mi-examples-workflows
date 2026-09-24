import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCommit, releaseLevel } from './commits.mjs';

const level = (...subjects) => releaseLevel(subjects.map((subject) => parseCommit({ subject })));

describe('parseCommit', () => {
  it('parses type, scope and description', () => {
    assert.deepEqual(parseCommit({ hash: 'abc', subject: 'feat(cli): add --dry-run' }), {
      hash: 'abc',
      type: 'feat',
      scope: 'cli',
      description: 'add --dry-run',
      breaking: false,
      breakingNote: null,
    });
  });

  it('keeps non-conventional subjects without a type', () => {
    const commit = parseCommit({ subject: 'Merge pull request #1 from org/develop' });

    assert.equal(commit.type, null);
    assert.equal(commit.description, 'Merge pull request #1 from org/develop');
  });

  it('treats a git-generated revert as a revert', () => {
    const commit = parseCommit({ subject: 'Revert "feat: add x"' });

    assert.equal(commit.type, 'revert');
    assert.equal(commit.description, 'feat: add x');
  });

  it('reads a multi-line BREAKING CHANGE footer up to the next blank line', () => {
    const body = 'Some context.\n\nBREAKING CHANGE: the `foo` input\nwas removed.\n\nRefs: #12';
    const commit = parseCommit({ subject: 'refactor: drop foo', body });

    assert.equal(commit.breaking, true);
    assert.equal(commit.breakingNote, 'the `foo` input was removed.');
  });

  it('accepts BREAKING-CHANGE and uses the description when the footer is empty', () => {
    assert.equal(parseCommit({ subject: 'fix: x', body: 'BREAKING-CHANGE: y' }).breakingNote, 'y');
    assert.equal(parseCommit({ subject: 'feat(api)!: drop v1' }).breakingNote, 'drop v1');
  });
});

describe('releaseLevel', () => {
  it('follows the angular release rules', () => {
    assert.equal(level('feat: a'), 'minor');
    assert.equal(level('fix: a'), 'patch');
    assert.equal(level('perf: a'), 'patch');
    assert.equal(level('revert: a'), 'patch');
    assert.equal(level('Revert "feat: a"'), 'patch');
  });

  it('never releases for other types or non-conventional commits', () => {
    assert.equal(level('docs: a', 'style: a', 'refactor: a', 'test: a', 'build: a', 'ci: a', 'chore: a'), null);
    assert.equal(level('Update README', 'wip'), null);
    assert.equal(level(), null);
  });

  it('picks the highest level', () => {
    assert.equal(level('fix: a', 'feat: b', 'docs: c'), 'minor');
    assert.equal(level('fix: a', 'chore!: b'), 'major');
  });

  it('treats a BREAKING CHANGE footer as major on any type', () => {
    const commits = [parseCommit({ subject: 'chore: bump', body: 'BREAKING CHANGE: node 24 only' })];

    assert.equal(releaseLevel(commits), 'major');
  });

  it('is case-insensitive for the type', () => {
    assert.equal(level('Feat: a'), 'minor');
  });
});
