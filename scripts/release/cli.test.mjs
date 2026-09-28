import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createRepo } from './fixtures.mjs';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));

let repo;

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.cleanup();
});

function run(args, env = {}) {
  const outputFile = join(repo.dir, '.github-output');

  writeFileSync(outputFile, '');

  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: repo.dir,
      env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_OUTPUT: outputFile, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return { status: 0, stdout, outputs: readFileSync(outputFile, 'utf8') };
  } catch (error) {
    return { status: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

describe('cli', () => {
  it('next-version prints the version and writes outputs', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('feat: a');

    const { status, stdout, outputs } = run(['next-version']);

    assert.equal(status, 0);
    assert.equal(stdout, '1.3.0\n');
    assert.equal(outputs, 'release=true\nversion=1.3.0\nlevel=minor\nlast-tag=v1.2.0\n');
  });

  it('next-beta reports no release with empty outputs', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('docs: a');

    const { status, stdout, outputs } = run(['next-beta']);

    assert.equal(status, 0);
    assert.equal(stdout, '');
    assert.match(outputs, /^release=false\nversion=\n/);
  });

  it('notes, changelog-insert and changelog-extract work together', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('feat: a');

    const notesFile = join(repo.dir, 'notes.md');
    const env = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'org/pkg' };

    assert.equal(run(['notes', '--version', '1.3.0', '--date', '2026-09-24', '--output', notesFile], env).status, 0);
    assert.match(readFileSync(notesFile, 'utf8'), /^## \[1\.3\.0\]\(https:\/\/github\.com\/org\/pkg\/compare\/v1\.2\.0\.\.\.v1\.3\.0\)/);

    assert.equal(run(['changelog-insert', '--version', '1.3.0', '--notes-file', notesFile]).status, 0);

    const { stdout } = run(['changelog-extract', '--version', '1.3.0']);

    assert.match(stdout, /^### Features\n\n\* a \(\[[0-9a-f]{7}\]/);
  });

  it('fails with a readable error and escapes workflow commands', () => {
    repo.commit('feat: untagged');

    const plain = run(['next-version']);

    assert.equal(plain.status, 1);
    assert.match(plain.stderr, /^error: No production tag/);

    const actions = run(['changelog-extract', '--version', '1.0.0', '--file', 'missing\n::warning::x.md'], {
      GITHUB_ACTIONS: 'true',
    });

    assert.equal(actions.status, 1);
    assert.match(actions.stderr, /^::error::/);
    assert.doesNotMatch(actions.stderr, /\n::warning::/);
  });

  it('release-notes falls back to conventional notes and reports why', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');
    repo.commit('fix: handle spaces');

    const env = { OPENROUTER_API_KEY: '', OPENAI_API_KEY: '', GITHUB_TOKEN: '', GITHUB_REPOSITORY: '', GITHUB_SERVER_URL: '' };
    const { status, stdout, outputs } = run(['release-notes', '--version', '1.2.1', '--date', '2026-09-25'], env);

    assert.equal(status, 0);
    assert.match(stdout, /^## 1\.2\.1 \(2026-09-25\)\n\n### Bug Fixes\n\n\* handle spaces \([0-9a-f]{7}\)\n$/);
    assert.match(outputs, /^source=conventional\nwarnings<<(EOF_[0-9a-f-]+)\nNo AI provider key is set \(OPENROUTER_API_KEY, OPENAI_API_KEY\).*\nGITHUB_TOKEN or GITHUB_REPOSITORY is not set.*\n\1\n$/);
  });

  it('release-notes validates --sources', () => {
    repo.commit('chore: init');
    repo.tag('v1.2.0');

    assert.equal(run(['release-notes', '--version', '1.2.1', '--sources', 'ai,magic']).status, 1);
    assert.match(run(['release-notes', '--version', '1.2.1', '--provider', 'magic']).stderr, /unknown AI provider "magic"/);
    assert.match(run(['release-notes', '--version', '1.2.1', '--model', 'x']).stderr, /--model needs --provider/);
  });

  it('rejects unknown commands and options', () => {
    assert.equal(run(['publish']).status, 2);
    assert.equal(run(['next-version', '--nope']).status, 1);
  });
});
