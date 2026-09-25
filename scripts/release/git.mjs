// Thin git wrapper. Every call passes an argument array to execFileSync, so
// nothing is ever interpreted by a shell.

import { execFileSync } from 'node:child_process';

const FIELD = '\x1f';
const RECORD = '\x1e';

export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function lines(output) {
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

// Non-merge commits in `range`, newest first.
export function readCommits(range, cwd) {
  const output = git(['log', '--no-merges', `--format=%H${FIELD}%s${FIELD}%b${RECORD}`, '--end-of-options', range], cwd);

  return output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [hash, subject, body = ''] = record.split(FIELD);

      return { hash, subject, body: body.trim() };
    });
}

// Files that add noise or could hold credentials, excluded from diffs that
// are sent to an AI model.
const DIFF_EXCLUDES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '*.lock',
  'dist/**',
  'build/**',
  'coverage/**',
  '*.min.js',
  '*.map',
  '.env*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
];

// Text diff for `range`, or '' if git fails (e.g. the diff exceeds maxBuffer).
export function readDiff(range, cwd) {
  const pathspecs = DIFF_EXCLUDES.map((pattern) => `:(exclude,glob)**/${pattern}`);

  try {
    return execFileSync('git', ['diff', '--no-color', '--no-ext-diff', '--end-of-options', range, '--', '.', ...pathspecs], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
}

export function readFileAt(ref, path, cwd) {
  return git(['show', '--end-of-options', `${ref}:${path}`], cwd);
}

export function resolveRef(ref, cwd) {
  return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], cwd);
}

// Tags starting with `v`. With `mergedInto`, only tags reachable from that ref.
export function listTags(cwd, { mergedInto } = {}) {
  const args = ['tag', '--list', 'v*'];

  if (mergedInto) args.push('--merged', mergedInto);

  return lines(git(args, cwd));
}

export function tagsPointingAt(ref, cwd) {
  return lines(git(['tag', '--list', 'v*', '--points-at', ref], cwd));
}
