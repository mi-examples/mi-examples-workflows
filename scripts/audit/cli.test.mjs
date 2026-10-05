import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const BRACES = 'GHSA-vfj7-8cjw-p6xm';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audit-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name, content) {
  const path = join(dir, name);

  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));

  return path;
}

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true', AUDIT_ALLOWLIST_URL: '', AUDIT_LEVEL: '', ...env },
  });

  return { code: result.status, out: result.stdout + result.stderr };
}

const report = {
  vulnerabilities: {
    braces: { severity: 'high', via: [{ title: 'stack exhaustion', url: `https://github.com/advisories/${BRACES}` }] },
    micromatch: { severity: 'high', via: ['braces'] },
  },
};

const allowlist = (until) => ({ entries: [{ id: BRACES, reason: 'unreachable here', until }] });

describe('audit cli', () => {
  it('passes when every finding is allowlisted, with one annotation per advisory', () => {
    const { code, out } = run(['--report', file('r.json', report), '--allowlist', file('a.json', allowlist('2999-01-01'))]);

    assert.equal(code, 0);
    assert.match(out, /::warning::Allowlisted GHSA-vfj7-8cjw-p6xm until 2999-01-01 \(braces, micromatch\): unreachable here/);
    assert.match(out, /✓ no unresolved findings/);
  });

  it('fails on a finding that is not allowlisted', () => {
    const { code, out } = run(['--report', file('r.json', report), '--allowlist', 'none']);

    assert.equal(code, 1);
    assert.match(out, /✗ braces \(high\): GHSA-vfj7-8cjw-p6xm/);
    assert.match(out, /Allowlist: off/);
  });

  it('fails again once the entry has expired, with an error annotation', () => {
    const { code, out } = run(['--report', file('r.json', report), '--allowlist', file('a.json', allowlist('2000-01-01'))]);

    assert.equal(code, 1);
    assert.match(out, /::error::The audit allowlist entry for GHSA-vfj7-8cjw-p6xm expired on 2000-01-01, so it applies no more\./);
  });

  it('fails closed when the allowlist cannot be loaded', () => {
    const { code, out } = run(['--report', file('r.json', report), '--allowlist', join(dir, 'missing.json')]);

    assert.equal(code, 1);
    assert.match(out, /::warning::Could not load the audit allowlist from .*missing\.json/);
  });

  it('reads the allowlist location from AUDIT_ALLOWLIST_URL', () => {
    const { code } = run(['--report', file('r.json', report)], {
      AUDIT_ALLOWLIST_URL: file('a.json', allowlist('2999-01-01')),
    });

    assert.equal(code, 0);
  });

  it('reports invalid allowlist entries and ignores them', () => {
    const { code, out } = run([
      '--report',
      file('r.json', report),
      '--allowlist',
      file('a.json', { entries: [{ id: BRACES, reason: '', until: '2999-01-01' }] }),
    ]);

    assert.equal(code, 1);
    assert.match(out, /::warning::Ignored audit allowlist entry 1 \(GHSA-vfj7-8cjw-p6xm\): "reason"/);
  });

  it('respects --level', () => {
    const { code } = run(['--report', file('r.json', report), '--allowlist', 'none', '--level', 'critical']);

    assert.equal(code, 0);
  });

  it('fails when npm audit itself reports an error', () => {
    const { code, out } = run([
      '--report',
      file('r.json', { error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } }),
    ]);

    assert.equal(code, 1);
    assert.match(out, /::error::npm audit failed: This command requires an existing lockfile\./);
  });
});
