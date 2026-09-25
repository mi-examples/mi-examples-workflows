import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { checkContent, checkPaths } from './check-pinned-actions.mjs';

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';

describe('checkContent', () => {
  it('accepts a full SHA with a version comment', () => {
    assert.deepEqual(checkContent(`      - uses: actions/checkout@${SHA} # v7.0.1`, 'a.yml'), []);
  });

  it('accepts a reusable workflow pinned by SHA', () => {
    const line = `    uses: mi-examples/mi-examples-workflows/.github/workflows/node-ci.yml@${SHA} # v1.0.0`;

    assert.deepEqual(checkContent(line, 'a.yml'), []);
  });

  it('accepts quoted refs and bare "uses:" keys', () => {
    assert.deepEqual(checkContent(`    uses: "actions/checkout@${SHA}" # v7`, 'a.yml'), []);
  });

  it('ignores local and self-repository actions and workflows', () => {
    assert.deepEqual(checkContent('      - uses: ./.github/actions/setup', 'a.yml'), []);
    assert.deepEqual(checkContent('      - uses: $/.github/actions/release-tools', 'a.yml'), []);
    assert.deepEqual(checkContent('    uses: $/.github/workflows/dependency-audit.yml', 'a.yml'), []);
  });

  it('rejects a tag', () => {
    const [problem] = checkContent('      - uses: actions/checkout@v7', 'a.yml');

    assert.match(problem, /^a\.yml:1: must be pinned by full commit SHA, got "v7"/);
  });

  it('rejects a branch and a short SHA', () => {
    const content = ['- uses: org/repo/.github/workflows/x.yml@main', '- uses: actions/checkout@3d3c42e # v7'].join('\n');

    assert.equal(checkContent(content, 'a.yml').length, 2);
  });

  it('rejects a SHA without a version comment', () => {
    const [problem] = checkContent(`      - uses: actions/checkout@${SHA}`, 'a.yml');

    assert.match(problem, /needs a version comment/);
  });

  it('rejects a SHA with a non-version comment', () => {
    const [problem] = checkContent(`      - uses: actions/checkout@${SHA} # latest`, 'a.yml');

    assert.match(problem, /needs a version comment/);
  });

  it('rejects a ref without @', () => {
    const [problem] = checkContent('      - uses: actions/checkout', 'a.yml');

    assert.match(problem, /missing @<sha>/);
  });

  it('requires docker images to be pinned by digest', () => {
    const digest = 'a'.repeat(64);

    assert.equal(checkContent('- uses: docker://alpine:3.20', 'a.yml').length, 1);
    assert.deepEqual(checkContent(`- uses: docker://alpine@sha256:${digest}`, 'a.yml'), []);
  });

  it('reports the right line numbers with CRLF endings', () => {
    const content = ['jobs:', '  a:', '    steps:', '      - uses: actions/checkout@v7'].join('\r\n');
    const [problem] = checkContent(content, 'a.yml');

    assert.match(problem, /^a\.yml:4:/);
  });

  it('ignores lines that only mention uses in text', () => {
    assert.deepEqual(checkContent('      - run: echo "no uses: here"', 'a.yml'), []);
  });
});

describe('checkPaths', () => {
  it('scans YAML files recursively and skips missing roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pin-check-'));

    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(dir, '.github', 'workflows', 'ok.yml'), `- uses: actions/checkout@${SHA} # v7.0.1\n`);
      writeFileSync(join(dir, '.github', 'workflows', 'bad.yaml'), '- uses: actions/checkout@v7\n');
      writeFileSync(join(dir, '.github', 'notes.md'), '- uses: actions/checkout@v7\n');

      const { files, problems } = checkPaths(['.github', 'templates'], dir);

      assert.equal(files.length, 2);
      assert.deepEqual(problems, ['.github/workflows/bad.yaml:1: must be pinned by full commit SHA, got "v7": actions/checkout@v7']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
