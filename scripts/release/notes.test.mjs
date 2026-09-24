import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCommit } from './commits.mjs';
import { renderNotes } from './notes.mjs';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const REPO = 'https://github.com/org/pkg';

const commits = (...entries) => entries.map(([subject, body]) => parseCommit({ hash: HASH, subject, body }));

describe('renderNotes', () => {
  it('groups commits by type in a fixed order with commit links', () => {
    const notes = renderNotes({
      version: '1.3.0',
      previousTag: 'v1.2.0',
      repoUrl: REPO,
      date: '2026-09-24',
      commits: commits(['fix(cli): handle spaces'], ['feat: add --dry-run'], ['Merge branch x'], ['chore: tidy']),
    });

    assert.equal(
      notes,
      [
        `## [1.3.0](${REPO}/compare/v1.2.0...v1.3.0) (2026-09-24)`,
        '',
        '### Features',
        '',
        `* add --dry-run ([0123456](${REPO}/commit/${HASH}))`,
        '',
        '### Bug Fixes',
        '',
        `* **cli:** handle spaces ([0123456](${REPO}/commit/${HASH}))`,
        '',
        '### Chores',
        '',
        `* tidy ([0123456](${REPO}/commit/${HASH}))`,
        '',
      ].join('\n'),
    );
  });

  it('lists breaking changes first', () => {
    const notes = renderNotes({
      version: '2.0.0',
      previousTag: 'v1.2.0',
      date: '2026-09-24',
      commits: commits(['feat(api)!: drop v1'], ['refactor: x', 'BREAKING CHANGE: config moved']),
    });

    assert.match(notes, /^## 2\.0\.0 \(2026-09-24\)\n\n### ⚠ BREAKING CHANGES\n\n\* \*\*api:\*\* drop v1\n\* config moved\n/);
    assert.match(notes, /\* \*\*api:\*\* drop v1 \(0123456\)/);
  });

  it('says so when nothing notable changed', () => {
    const notes = renderNotes({ version: '1.2.1', commits: commits(['Update README']), date: '2026-09-24' });

    assert.equal(notes, '## 1.2.1 (2026-09-24)\n\nNo notable changes.\n');
  });
});
