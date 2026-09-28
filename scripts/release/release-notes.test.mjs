import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createRepo } from './fixtures.mjs';
import { buildReleaseNotes } from './release-notes.mjs';

const REPO_URL = 'https://github.com/org/pkg';
const HEADING = `## [1.3.0](${REPO_URL}/compare/v1.2.0...v1.3.0) (2026-09-25)`;

let repo;

beforeEach(() => {
  repo = createRepo();
  repo.commit('chore: init');
  repo.tag('v1.2.0');
  repo.commit('feat: add --dry-run');
});

afterEach(() => {
  repo.cleanup();
});

const build = (options) =>
  buildReleaseNotes({ cwd: repo.dir, version: '1.3.0', from: 'v1.2.0', repoUrl: REPO_URL, date: '2026-09-25', retryDelayMs: 0, ...options });

const aiReply = (content) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('buildReleaseNotes', () => {
  it('uses AI notes when the key is set', async () => {
    const seen = [];
    const result = await build({
      env: { OPENAI_API_KEY: 'k', GITHUB_REPOSITORY: 'org/pkg' },
      fetchImpl: async (url, init) => {
        seen.push(JSON.parse(init.body).messages[1].content);

        return aiReply('### Features\n- Added a `--dry-run` flag');
      },
    });

    assert.equal(result.source, 'ai');
    assert.equal(result.detail, 'OpenAI, gpt-6-luna');
    assert.deepEqual(result.warnings, []);
    assert.equal(result.section, `${HEADING}\n\n### Features\n\n- Added a \`--dry-run\` flag\n`);
    assert.match(seen[0], /- feat: add --dry-run/);
  });

  it('prefers the first provider in the configured order', async () => {
    const urls = [];
    const result = await build({
      env: { OPENROUTER_API_KEY: 'r', OPENAI_API_KEY: 'k', GITHUB_REPOSITORY: 'org/pkg' },
      fetchImpl: async (url) => {
        urls.push(url);

        return aiReply('### Features\n- Added a flag');
      },
    });

    assert.equal(result.detail, 'OpenRouter, anthropic/claude-opus-5.5');
    assert.ok(urls.every((url) => url.startsWith('https://openrouter.ai/')));
  });

  it('falls back to the next provider when one fails, with a warning', async () => {
    const result = await build({
      env: { OPENROUTER_API_KEY: 'r', OPENAI_API_KEY: 'k', GITHUB_REPOSITORY: 'org/pkg' },
      fetchImpl: async (url) =>
        url.startsWith('https://openrouter.ai/') ? new Response('insufficient credits', { status: 402 }) : aiReply('### Features\n- Added a flag'),
    });

    assert.equal(result.source, 'ai');
    assert.equal(result.detail, 'OpenAI, gpt-6-luna');
    assert.deepEqual(result.warnings, ['OpenRouter release notes failed: OpenRouter request failed: 402 insufficient credits']);
  });

  it('falls back to GitHub notes without a key, with a warning', async () => {
    const result = await build({
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'org/pkg' },
      fetchImpl: async () => new Response(JSON.stringify({ body: "## What's Changed\n* feat: add --dry-run by @dev" }), { status: 200 }),
    });

    assert.equal(result.source, 'github');
    assert.equal(result.warnings[0], 'No AI provider key is set (OPENROUTER_API_KEY, OPENAI_API_KEY), so AI release notes were skipped.');
    assert.equal(result.section, `${HEADING}\n\n### What's Changed\n* feat: add --dry-run by @dev\n`);
  });

  it('falls back to conventional notes when AI and GitHub both fail, and redacts warnings', async () => {
    const result = await build({
      env: { OPENAI_API_KEY: 'k', GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'org/pkg' },
      fetchImpl: async (url) =>
        url.includes('openai')
          ? new Response(`Incorrect API key provided: sk-proj-${'x'.repeat(30)}`, { status: 401 })
          : new Response('forbidden', { status: 403 }),
    });

    assert.equal(result.source, 'conventional');
    assert.match(result.section, /^## \[1\.3\.0\].*\n\n### Features\n\n\* add --dry-run \(\[[0-9a-f]{7}\]/);
    assert.equal(result.warnings.length, 2);
    assert.match(result.warnings[0], /^OpenAI release notes failed: OpenAI request failed: 401 Incorrect API key provided: \[REDACTED\]$/);
    assert.match(result.warnings[1], /^github release notes failed: GitHub generate-notes failed: 403 forbidden$/);
  });

  it('respects the source order and rejects unknown sources', async () => {
    const result = await build({ sources: ['conventional', 'ai'], env: { OPENAI_API_KEY: 'k' } });

    assert.equal(result.source, 'conventional');
    await assert.rejects(build({ sources: ['magic'], env: {} }), /No release notes source succeeded\. magic release notes failed: unknown source/);
  });
});
