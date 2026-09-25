import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { CALLERS, inputGroups, renderAll, renderCaller, renderConfig, validateConfig } from './render.mjs';
import { loadTemplatesFromDir } from './source.mjs';

const TEMPLATES = loadTemplatesFromDir(join(dirname(fileURLToPath(import.meta.url)), '../../templates'));
const PIN = { sha: 'a'.repeat(40), version: 'v1.2.3' };

describe('renderCaller', () => {
  it('pins every reference and adds the managed-file header', () => {
    const rendered = renderCaller(TEMPLATES.ci, PIN);

    assert.match(rendered, /^# Managed by mi-examples-workflows\. Do not edit by hand/);
    assert.match(rendered, /node-ci\.yml@a{40} # v1\.2\.3\n$/);
    assert.doesNotMatch(rendered, /\{\{(sha|version|with:|inputs:)/);
    assert.match(rendered, /sync pull request\.\n\nname: CI\n/);
  });

  it('renders a with: block from inputs, quoting strings safely', () => {
    const rendered = renderCaller(TEMPLATES.ci, {
      ...PIN,
      inputs: { ci: { 'dist-dir': 'dist', 'extra-scripts': 'a\nb: "c"', 'free-disk-space': true, 'timeout-minutes': 30 } },
    });

    assert.match(
      rendered,
      /    uses: .*\n    with:\n      dist-dir: "dist"\n      extra-scripts: "a\\nb: \\"c\\""\n      free-disk-space: true\n      timeout-minutes: 30\n$/,
    );
  });

  it('adds inputs to an existing with: block', () => {
    const rendered = renderCaller(TEMPLATES.release, { ...PIN, inputs: { prepare: { base: 'develop' } } });

    assert.match(rendered, /      app-id: \$\{\{ vars\.WORKFLOWS_BOT_APP_ID \}\}\n      base: "develop"\n    secrets:/);
  });

  it('leaves GitHub expressions alone', () => {
    assert.match(renderCaller(TEMPLATES.ci, PIN), /group: ci-\$\{\{ github\.event\.pull_request\.number \}\}/);
  });

  it('normalizes CRLF templates to LF', () => {
    assert.doesNotMatch(renderCaller(TEMPLATES.ci.replaceAll('\n', '\r\n'), PIN), /\r/);
  });

  it('rejects a bad pin', () => {
    assert.throws(() => renderCaller(TEMPLATES.ci, { ...PIN, sha: 'main' }), /invalid commit SHA/);
    assert.throws(() => renderCaller(TEMPLATES.ci, { ...PIN, version: '1.2.3' }), /invalid version/);
  });
});

describe('validateConfig', () => {
  it('knows the input groups of each template', () => {
    assert.deepEqual(inputGroups(TEMPLATES.release), ['prepare', 'publish', 'publish']);
    assert.deepEqual(inputGroups(TEMPLATES.ci), ['ci']);
  });

  it('rejects unknown callers, unused groups, bad names and bad values', () => {
    assert.throws(() => validateConfig({ callers: ['nope'] }, TEMPLATES), /unknown caller "nope"/);
    assert.throws(() => validateConfig({ callers: [] }, TEMPLATES), /at least one caller/);
    assert.throws(() => validateConfig({ callers: ['ci'], inputs: { publish: {} } }, TEMPLATES), /"publish" isn't used/);
    assert.throws(() => validateConfig({ callers: ['ci'], inputs: { ci: { 'Bad Name': 1 } } }, TEMPLATES), /invalid input name/);
    assert.throws(() => validateConfig({ callers: ['ci'], inputs: { ci: { x: ['a'] } } }, TEMPLATES), /strings, numbers or booleans/);
    assert.throws(() => validateConfig([], TEMPLATES), /must be a JSON object/);
  });
});

describe('renderAll and renderConfig', () => {
  it('renders the listed callers at their workflow paths', () => {
    const files = renderAll(TEMPLATES, { callers: ['release', 'ci'], inputs: {} }, PIN);

    assert.deepEqual([...files.keys()], ['.github/workflows/release.yml', '.github/workflows/ci.yml']);
  });

  it('writes the config in a stable order', () => {
    assert.equal(
      renderConfig({ callers: ['release', 'ci', 'secret-scan'], inputs: { ci: { 'dist-dir': 'dist' } } }),
      '{\n  "callers": [\n    "ci",\n    "secret-scan",\n    "release"\n  ],\n  "inputs": {\n    "ci": {\n      "dist-dir": "dist"\n    }\n  }\n}\n',
    );
  });

  it('has a template for every caller', () => {
    assert.deepEqual(Object.keys(TEMPLATES).sort(), Object.keys(CALLERS).sort());
  });
});
