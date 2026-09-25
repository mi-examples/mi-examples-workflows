import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { CONFIG_PATH, renderAll } from './render.mjs';
import { loadTemplatesFromDir } from './source.mjs';
import { SYNC_BRANCH, syncRepository } from './sync.mjs';

const TEMPLATES = loadTemplatesFromDir(join(dirname(fileURLToPath(import.meta.url)), '../../templates'));
const PIN = { sha: 'a'.repeat(40), version: 'v1.2.3' };
const REPO = 'org/pkg';
const CONFIG = { callers: ['ci', 'secret-scan'], inputs: { ci: { 'dist-dir': 'dist' } } };

const encode = (text) => ({ content: Buffer.from(text).toString('base64') });

// A tiny in-memory GitHub API: branches, files on develop, refs and pulls.
function fakeGitHub({ files = {}, develop = true, openPull = null } = {}) {
  const calls = [];
  const request = async (method, path, body, { allow404 = false } = {}) => {
    calls.push({ method, path, body });

    const missing = () => {
      if (allow404) return null;
      throw new Error(`404 ${path}`);
    };

    if (method === 'GET' && path === `/repos/${REPO}`) return { default_branch: 'main' };
    if (method === 'GET' && path === `/repos/${REPO}/branches/develop`) return develop ? { name: 'develop' } : missing();

    const content = /^\/repos\/org\/pkg\/contents\/(.+)\?ref=/.exec(path);

    if (method === 'GET' && content) return files[content[1]] === undefined ? missing() : encode(files[content[1]]);
    if (method === 'GET' && path.endsWith('/git/ref/heads/develop')) return { object: { sha: 'base-sha' } };
    if (method === 'GET' && path.endsWith('/git/ref/heads/main')) return { object: { sha: 'main-sha' } };
    if (method === 'GET' && path.endsWith('/git/commits/base-sha')) return { tree: { sha: 'base-tree' } };
    if (method === 'GET' && path.endsWith('/git/commits/main-sha')) return { tree: { sha: 'main-tree' } };
    if (method === 'POST' && path.endsWith('/git/trees')) return { sha: 'new-tree' };
    if (method === 'POST' && path.endsWith('/git/commits')) return { sha: 'new-commit' };
    if (method === 'GET' && path.endsWith(`/git/ref/heads/${SYNC_BRANCH}`)) return openPull ? { object: { sha: 'old' } } : missing();
    if (method === 'PATCH' && path.includes('/git/refs/heads/')) return {};
    if (method === 'POST' && path.endsWith('/git/refs')) return {};
    if (method === 'GET' && path.includes('/pulls?')) return openPull ? [openPull] : [];
    if (method === 'POST' && path.endsWith('/pulls')) return { html_url: 'https://github.com/org/pkg/pull/9' };
    if (method === 'PATCH' && path.includes('/pulls/')) return { html_url: `https://github.com/org/pkg/pull/${openPull.number}` };

    throw new Error(`unexpected ${method} ${path}`);
  };

  return { request, calls };
}

const inSyncFiles = () => ({
  [CONFIG_PATH]: JSON.stringify(CONFIG),
  ...Object.fromEntries(renderAll(TEMPLATES, CONFIG, PIN)),
});

describe('syncRepository', () => {
  it('skips a repository without the config file', async () => {
    const { request } = fakeGitHub();
    const result = await syncRepository({ request, repo: REPO, templates: TEMPLATES, pin: PIN });

    assert.equal(result.status, 'not-installed');
  });

  it('does nothing when the callers match', async () => {
    const { request, calls } = fakeGitHub({ files: inSyncFiles() });
    const result = await syncRepository({ request, repo: REPO, templates: TEMPLATES, pin: PIN });

    assert.equal(result.status, 'in-sync');
    assert.ok(calls.every(({ method }) => method === 'GET'));
  });

  it('treats CRLF-only differences as in sync', async () => {
    const files = Object.fromEntries(Object.entries(inSyncFiles()).map(([path, text]) => [path, text.replaceAll('\n', '\r\n')]));
    const { request } = fakeGitHub({ files });

    assert.equal((await syncRepository({ request, repo: REPO, templates: TEMPLATES, pin: PIN })).status, 'in-sync');
  });

  it('reports drift without writing in a dry run', async () => {
    const files = { ...inSyncFiles(), '.github/workflows/ci.yml': 'edited by hand\n' };
    const { request, calls } = fakeGitHub({ files });
    const result = await syncRepository({ request, repo: REPO, templates: TEMPLATES, pin: PIN, dryRun: true });

    assert.deepEqual(result, { status: 'drift', base: 'develop', files: ['.github/workflows/ci.yml'] });
    assert.ok(calls.every(({ method }) => method === 'GET'));
  });

  it('commits only the drifted files on top of develop and opens a pull request', async () => {
    const files = inSyncFiles();

    delete files['.github/workflows/secret-scan.yml'];
    files['.github/workflows/ci.yml'] = 'edited by hand\n';

    const { request, calls } = fakeGitHub({ files });
    const result = await syncRepository({ request, repo: REPO, templates: TEMPLATES, pin: PIN });
    const find = (method, suffix) => calls.find((call) => call.method === method && call.path.endsWith(suffix));

    assert.equal(result.status, 'updated');
    assert.equal(result.pr, 'https://github.com/org/pkg/pull/9');
    assert.deepEqual(find('POST', '/git/trees').body.tree.map((entry) => entry.path), ['.github/workflows/ci.yml', '.github/workflows/secret-scan.yml']);
    assert.equal(find('POST', '/git/trees').body.base_tree, 'base-tree');
    assert.deepEqual(find('POST', '/git/commits').body.parents, ['base-sha']);
    assert.doesNotMatch(find('POST', '/git/commits').body.message, /skip ci/i);
    assert.deepEqual(find('POST', '/git/refs').body, { ref: `refs/heads/${SYNC_BRANCH}`, sha: 'new-commit' });
    assert.equal(find('POST', '/pulls').body.base, 'develop');
  });

  it('force-updates the sync branch and the open pull request', async () => {
    const files = { ...inSyncFiles(), '.github/workflows/ci.yml': 'edited by hand\n' };
    const { request, calls } = fakeGitHub({ files, openPull: { number: 4 } });
    const result = await syncRepository({ request, repo: REPO, templates: TEMPLATES, pin: PIN });

    assert.equal(result.pr, 'https://github.com/org/pkg/pull/4');
    assert.deepEqual(calls.find((call) => call.method === 'PATCH' && call.path.includes('/git/refs/')).body, { sha: 'new-commit', force: true });
    assert.ok(!calls.some((call) => call.method === 'POST' && call.path.endsWith('/pulls')));
  });

  it('targets the default branch when there is no develop', async () => {
    const files = { ...inSyncFiles(), '.github/workflows/ci.yml': 'edited by hand\n' };
    const { request, calls } = fakeGitHub({ files, develop: false });
    const result = await syncRepository({ request, repo: REPO, templates: TEMPLATES, pin: PIN });

    assert.equal(result.base, 'main');
    assert.equal(calls.find((call) => call.method === 'POST' && call.path.endsWith('/pulls')).body.base, 'main');
  });

  it('rejects an invalid repository name', async () => {
    await assert.rejects(syncRepository({ request: async () => ({}), repo: '../x', templates: TEMPLATES, pin: PIN }), /invalid repository/);
  });
});
