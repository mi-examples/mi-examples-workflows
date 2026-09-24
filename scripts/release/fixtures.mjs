// Throwaway git repositories for tests.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

export function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'release-tools-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
      cwd: dir,
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  git('init', '-q', '-b', 'main');

  return {
    dir,
    git,
    commit(subject, body) {
      git('commit', '-q', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : []));

      return git('rev-parse', 'HEAD');
    },
    tag(name, ref = 'HEAD') {
      git('tag', name, ref);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
