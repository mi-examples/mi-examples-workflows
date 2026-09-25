import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createRepo } from '../scripts/release/fixtures.mjs';
import { install } from './install.mjs';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../templates');
const PIN_ARGS = ['--templates-dir', TEMPLATES_DIR, '--sha', 'a'.repeat(40), '--version', 'v1.2.3'];

let repo;
let output;

beforeEach(() => {
  repo = createRepo();
  repo.commit('chore: init');
  output = [];
});

afterEach(() => {
  repo.cleanup();
});

const run = (...args) => install([...args, ...PIN_ARGS], { cwd: repo.dir, log: (line) => output.push(line) });
const read = (path) => readFileSync(join(repo.dir, path), 'utf8');

describe('install', () => {
  it('installs the base callers and the config', async () => {
    const result = await run();

    assert.deepEqual(result.changed, [
      '.github/workflows/ci.yml',
      '.github/workflows/secret-scan.yml',
      '.github/workflows/dependency-audit.yml',
      '.github/mi-examples-workflows.json',
    ]);
    assert.match(read('.github/workflows/ci.yml'), /node-ci\.yml@a{40} # v1\.2\.3/);
    assert.deepEqual(JSON.parse(read('.github/mi-examples-workflows.json')).callers, ['ci', 'secret-scan', 'dependency-audit']);
  });

  it('adds the release caller, and the main-ahead check only with a develop branch', async () => {
    await run('--release');

    assert.ok(existsSync(join(repo.dir, '.github/workflows/release.yml')));
    assert.ok(!existsSync(join(repo.dir, '.github/workflows/main-ahead-check.yml')));

    repo.git('branch', 'develop');
    await run('--release');

    assert.ok(existsSync(join(repo.dir, '.github/workflows/main-ahead-check.yml')));
  });

  it('is idempotent and keeps the settings from the config', async () => {
    await run();

    const config = JSON.parse(read('.github/mi-examples-workflows.json'));

    config.inputs.ci = { 'dist-dir': 'dist' };
    writeFileSync(join(repo.dir, '.github/mi-examples-workflows.json'), JSON.stringify(config));

    const second = await run();

    assert.deepEqual(second.changed, ['.github/workflows/ci.yml', '.github/mi-examples-workflows.json']);
    assert.match(read('.github/workflows/ci.yml'), /with:\n {6}dist-dir: "dist"\n$/);
    assert.deepEqual((await run()).changed, []);
  });

  it('writes LF files and treats CRLF copies as unchanged', async () => {
    await run();

    const path = join(repo.dir, '.github/workflows/ci.yml');

    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('\n', '\r\n'));

    assert.deepEqual((await run()).changed, []);
  });

  it('writes nothing in a dry run', async () => {
    const result = await run('--dry-run');

    assert.equal(result.changed.length, 4);
    assert.ok(!existsSync(join(repo.dir, '.github')));
  });

  it('works from a subdirectory and reports legacy files', async () => {
    mkdirSync(join(repo.dir, '.github/workflows'), { recursive: true });
    writeFileSync(join(repo.dir, '.github/workflows/release-beta.yml'), 'old');
    mkdirSync(join(repo.dir, 'src'));

    await install(PIN_ARGS, { cwd: join(repo.dir, 'src'), log: (line) => output.push(line) });

    assert.ok(existsSync(join(repo.dir, '.github/workflows/ci.yml')));
    assert.ok(output.some((line) => line.includes('.github/workflows/release-beta.yml')));
  });

  it('rejects unknown options and an invalid config', async () => {
    await assert.rejects(run('--force'), /Unknown option/);

    mkdirSync(join(repo.dir, '.github'), { recursive: true });
    writeFileSync(join(repo.dir, '.github/mi-examples-workflows.json'), JSON.stringify({ callers: ['ci'], inputs: { ci: { x: [] } } }));

    await assert.rejects(run(), /strings, numbers or booleans/);
  });
});
