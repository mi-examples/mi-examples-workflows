#!/usr/bin/env node

// Fails when a workflow, composite action or caller template references an
// action or reusable workflow by anything other than a full commit SHA with a
// version comment, e.g. `uses: actions/checkout@<40-hex sha> # v7.0.1`.
// Dependabot keeps both the SHA and the comment up to date.
//
// Usage: node scripts/check-pinned-actions.mjs [dir-or-file ...]
// Defaults to `.github` and `templates` relative to the current directory.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOTS = ['.github', 'templates'];
const YAML_FILE_RE = /\.ya?ml$/;
const USES_RE = /^\s*(?:-\s+)?uses:\s*(['"]?)([^\s'"#]+)\1\s*(?:#\s*(.*?))?\s*$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DOCKER_DIGEST_RE = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const VERSION_COMMENT_RE = /^v?\d+(\.\d+){0,2}\b/;

export function checkContent(content, file) {
  const problems = [];

  content.split(/\r?\n/).forEach((line, index) => {
    const match = USES_RE.exec(line);

    if (!match) return;

    const [, , ref, comment] = match;
    const location = `${file}:${index + 1}`;

    // Local (`./`) and self-repository (`$/`) references resolve inside this
    // repo at the commit that is running.
    if (ref.startsWith('./') || ref.startsWith('$/')) return;

    if (ref.startsWith('docker://')) {
      if (!DOCKER_DIGEST_RE.test(ref)) {
        problems.push(`${location}: docker image must be pinned by @sha256 digest: ${ref}`);
      }

      return;
    }

    const at = ref.lastIndexOf('@');

    if (at === -1) {
      problems.push(`${location}: missing @<sha>: ${ref}`);

      return;
    }

    const pin = ref.slice(at + 1);

    // Caller templates are pinned when rendered (scripts/callers/render.mjs).
    if (pin === '{{sha}}' && comment === '{{version}}') return;

    if (!SHA_RE.test(pin)) {
      problems.push(`${location}: must be pinned by full commit SHA, got "${pin}": ${ref}`);
    } else if (!comment || !VERSION_COMMENT_RE.test(comment)) {
      problems.push(`${location}: pinned SHA needs a version comment, e.g. "# v1.2.3": ${ref}`);
    }
  });

  return problems;
}

function collectFiles(path) {
  if (!existsSync(path)) return [];

  if (statSync(path).isFile()) return YAML_FILE_RE.test(path) ? [path] : [];

  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => collectFiles(join(path, entry.name)));
}

export function checkPaths(paths, cwd = process.cwd()) {
  const files = paths.flatMap((path) => collectFiles(resolve(cwd, path)));
  const problems = files.flatMap((file) =>
    checkContent(readFileSync(file, 'utf8'), relative(cwd, file).replaceAll('\\', '/')),
  );

  return { files, problems };
}

function main() {
  const roots = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_ROOTS;
  const { files, problems } = checkPaths(roots);

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`\n${problems.length} unpinned reference(s) in ${files.length} file(s).`);
    process.exitCode = 1;

    return;
  }

  console.log(`Checked ${files.length} file(s): every action and reusable workflow is SHA-pinned.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
