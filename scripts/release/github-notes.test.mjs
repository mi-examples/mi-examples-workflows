import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { githubNotes, tidyGithubNotes } from './github-notes.mjs';

const GENERATED = [
  "## What's Changed",
  '* feat: add x by @dev in https://github.com/org/pkg/pull/12',
  '',
  '## New Contributors',
  '* @dev made their first contribution',
  '',
  '**Full Changelog**: https://github.com/org/pkg/compare/v1.2.0...v1.3.0',
].join('\n');

describe('tidyGithubNotes', () => {
  it('demotes headings and drops the Full Changelog line', () => {
    assert.equal(
      tidyGithubNotes(GENERATED),
      [
        "### What's Changed",
        '* feat: add x by @dev in https://github.com/org/pkg/pull/12',
        '',
        '### New Contributors',
        '* @dev made their first contribution',
      ].join('\n'),
    );
  });
});

describe('githubNotes', () => {
  it('calls generate-notes for the target commit and previous tag', async () => {
    let request;
    const notes = await githubNotes({
      repository: 'org/pkg',
      token: 't',
      tagName: 'v1.3.0',
      target: 'abc123',
      previousTag: 'v1.2.0',
      fetchImpl: async (url, init) => {
        request = { url, init };

        return new Response(JSON.stringify({ name: 'v1.3.0', body: GENERATED }), { status: 200 });
      },
    });

    assert.equal(request.url, 'https://api.github.com/repos/org/pkg/releases/generate-notes');
    assert.equal(request.init.headers.Authorization, 'Bearer t');
    assert.deepEqual(JSON.parse(request.init.body), { tag_name: 'v1.3.0', target_commitish: 'abc123', previous_tag_name: 'v1.2.0' });
    assert.match(notes, /^### What's Changed/);
  });

  it('rejects API errors, empty notes and invalid repositories', async () => {
    const respond = (body, status) => async () => new Response(body, { status });
    const base = { repository: 'org/pkg', token: 't', tagName: 'v1', target: 'a', previousTag: 'v0' };

    await assert.rejects(githubNotes({ ...base, fetchImpl: respond('nope', 403) }), /403 nope/);
    await assert.rejects(githubNotes({ ...base, fetchImpl: respond('{"body":""}', 200) }), /empty/);
    await assert.rejects(githubNotes({ ...base, repository: '../x', fetchImpl: respond('{}', 200) }), /invalid repository/);
  });
});
