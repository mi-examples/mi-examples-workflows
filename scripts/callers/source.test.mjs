import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadTemplatesAt, parseTagRefs, pickRelease } from './source.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

describe('parseTagRefs', () => {
  it('prefers the peeled commit of annotated tags and ignores prereleases', () => {
    const tags = parseTagRefs(
      [`${A}\trefs/tags/v0.5.0`, `${B}\trefs/tags/v0.5.0^{}`, `${C}\trefs/tags/v0.10.0`, `${A}\trefs/tags/v1.0.0-rc.1`, `${A}\trefs/heads/main`].join('\n'),
    );

    assert.deepEqual([...tags], [['v0.5.0', B], ['v0.10.0', C]]);
  });
});

describe('pickRelease', () => {
  const tags = new Map([['v0.5.0', B], ['v0.10.0', C]]);

  it('picks the highest version by semver', () => {
    assert.deepEqual(pickRelease(tags), { version: 'v0.10.0', sha: C });
  });

  it('picks a requested version, with or without the v', () => {
    assert.deepEqual(pickRelease(tags, '0.5.0'), { version: 'v0.5.0', sha: B });
    assert.throws(() => pickRelease(tags, 'v9.9.9'), /no release v9\.9\.9/);
    assert.throws(() => pickRelease(new Map()), /no releases yet/);
  });
});

describe('loadTemplatesAt', () => {
  it('downloads every template at the pinned commit', async () => {
    const urls = [];
    const templates = await loadTemplatesAt(A, {
      fetchImpl: async (url) => {
        urls.push(url);

        return new Response(`template ${url.split('/').pop()}`, { status: 200 });
      },
    });

    assert.equal(urls.length, 5);
    assert.ok(urls.every((url) => url.startsWith(`https://raw.githubusercontent.com/mi-examples/mi-examples-workflows/${A}/templates/`)));
    assert.equal(templates.release, 'template release.yml');
  });

  it('fails when a template is missing at that commit', async () => {
    await assert.rejects(loadTemplatesAt(A, { fetchImpl: async () => new Response('', { status: 404 }) }), /could not download .* 404/);
  });
});
