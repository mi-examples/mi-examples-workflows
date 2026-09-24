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

// Tags starting with `v`. With `mergedInto`, only tags reachable from that ref.
export function listTags(cwd, { mergedInto } = {}) {
  const args = ['tag', '--list', 'v*'];

  if (mergedInto) args.push('--merged', mergedInto);

  return lines(git(args, cwd));
}

export function tagsPointingAt(ref, cwd) {
  return lines(git(['tag', '--list', 'v*', '--points-at', ref], cwd));
}
