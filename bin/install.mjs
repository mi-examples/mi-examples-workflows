#!/usr/bin/env node

// Installs or updates the shared-workflow callers in the current package
// repository:
//
//   npx github:mi-examples/mi-examples-workflows [--release] [--version vX.Y.Z] [--dry-run]
//
// It writes .github/workflows/<caller>.yml from the templates of a released
// version, pinned by commit SHA, and keeps the repository's own settings in
// .github/mi-examples-workflows.json. Re-running is safe: unchanged files
// are left alone.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { BASE_CALLERS, CONFIG_PATH, callerPath, renderAll, renderConfig } from '../scripts/callers/render.mjs';
import { loadTemplatesAt, loadTemplatesFromDir, resolveRelease } from '../scripts/callers/source.mjs';

const USAGE = `Usage: npx github:mi-examples/mi-examples-workflows [options]

Installs or updates the shared-workflow callers in the current repository.

Options:
  --release          Also install the release caller (and the main-ahead check when
                     the repository has a develop branch).
  --version <vX.Y.Z> Pin this release instead of the latest one.
  --dry-run          Show what would change without writing anything.
  -h, --help         Show this help.

Settings live in ${CONFIG_PATH}. Edit that file and re-run to change them.
Docs: https://github.com/mi-examples/mi-examples-workflows/blob/main/docs/workflows.md
`;

// Workflow files the shared callers replace. They're reported, not deleted.
const LEGACY_FILES = [
  '.github/workflows/release-beta.yml',
  '.github/workflows/test.yml',
  '.github/workflows/publish.yml',
  '.releaserc',
  '.releaserc.js',
  '.releaserc.json',
  'release.config.js',
];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function hasDevelopBranch(root) {
  for (const ref of ['refs/remotes/origin/develop', 'refs/heads/develop']) {
    try {
      git(['rev-parse', '--verify', '--quiet', ref], root);

      return true;
    } catch {
      // try the next ref
    }
  }

  return false;
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null;
}

export async function install(argv = process.argv.slice(2), { cwd = process.cwd(), log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      release: { type: 'boolean', default: false },
      version: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      // For tests and local development: use templates from a directory and
      // a given pin instead of downloading a release.
      'templates-dir': { type: 'string' },
      sha: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    log(USAGE);

    return { changed: [] };
  }

  const root = git(['rev-parse', '--show-toplevel'], cwd);
  const configFile = join(root, CONFIG_PATH);
  const existing = readText(configFile);
  const config = existing ? JSON.parse(existing) : { callers: [...BASE_CALLERS], inputs: {} };

  config.callers = [...new Set([...(config.callers ?? []), ...BASE_CALLERS])];
  config.inputs = config.inputs ?? {};

  if (values.release) {
    config.callers.push('release');
    if (hasDevelopBranch(root)) config.callers.push('main-ahead-check');
    config.callers = [...new Set(config.callers)];
  }

  let pin;
  let templates;

  if (values['templates-dir']) {
    if (!values.sha || !values.version) throw new Error('--templates-dir needs --sha and --version');

    pin = { sha: values.sha, version: values.version };
    templates = loadTemplatesFromDir(resolve(cwd, values['templates-dir']));
  } else {
    pin = resolveRelease({ requested: values.version });
    templates = await loadTemplatesAt(pin.sha);
  }

  const files = renderAll(templates, config, pin);

  files.set(CONFIG_PATH, renderConfig(config));

  const changed = [];

  log(`mi-examples-workflows ${pin.version} (${pin.sha.slice(0, 7)})${values['dry-run'] ? ', dry run' : ''}`);

  for (const [path, content] of files) {
    const target = join(root, path);
    const current = readText(target);
    const status = current === null ? 'created' : current === content ? 'unchanged' : 'updated';

    log(`  ${status.padEnd(9)} ${path}`);

    if (status === 'unchanged') continue;

    changed.push(path);

    if (!values['dry-run']) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }

  const legacy = LEGACY_FILES.filter((path) => existsSync(join(root, path)));

  if (legacy.length > 0) {
    log('\nThese files belong to the old per-repository setup; remove them once the new callers work:');
    for (const path of legacy) log(`  ${path}`);
  }

  if (config.callers.includes('release')) {
    log(
      '\nBefore the first release: create the npm-publish environment and point the npm trusted publisher at it.\n' +
        'See https://github.com/mi-examples/mi-examples-workflows/blob/main/docs/npm-publishing.md',
    );
  }

  return { changed, files: [...files.keys()], pin, callers: config.callers.map(callerPath) };
}

// npx runs the bin through a symlink in node_modules/.bin, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await install();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
