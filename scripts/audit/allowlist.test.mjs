import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { advisoryIds, evaluate, ghsaId, isActive, parseAllowlist } from './allowlist.mjs';

const BRACES = 'GHSA-vfj7-8cjw-p6xm';
const CACHE = 'GHSA-ch52-4w7c-c8xp';

// The shape of `npm audit --json` (npm 7+): braces has the advisory, the packages above it inherit it.
const report = {
  vulnerabilities: {
    braces: {
      severity: 'high',
      via: [{ title: 'braces stack exhaustion', url: `https://github.com/advisories/${BRACES}` }],
    },
    micromatch: { severity: 'high', via: ['braces'] },
    'http-proxy-middleware': { severity: 'high', via: ['micromatch'] },
    'http-cache-semantics': {
      severity: 'high',
      via: [{ title: 'max-stale disclosure', url: `https://github.com/advisories/${CACHE}` }],
    },
    'some-moderate': {
      severity: 'moderate',
      via: [{ title: 'minor', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }],
    },
  },
};

const entry = (id, until = '2026-11-15') => ({ id, reason: 'unreachable', until });
const now = new Date('2026-10-05T12:00:00Z');

describe('parseAllowlist', () => {
  it('keeps valid entries and trims the reason', () => {
    const { entries, problems } = parseAllowlist({ entries: [{ id: BRACES, reason: '  why  ', until: '2026-11-15' }] });

    assert.deepEqual(entries, [{ id: BRACES, reason: 'why', until: '2026-11-15' }]);
    assert.deepEqual(problems, []);
  });

  it('drops and reports invalid entries, keeping the valid ones', () => {
    const { entries, problems } = parseAllowlist({
      entries: [
        { id: 'CVE-2026-1', reason: 'x', until: '2026-11-15' },
        { id: BRACES, reason: '', until: '2026-11-15' },
        { id: CACHE, reason: 'x', until: 'next month' },
        'nope',
        entry(BRACES),
      ],
    });

    assert.deepEqual(entries, [entry(BRACES)]);
    assert.equal(problems.length, 4);
    assert.match(problems[0], /entry 1 \(CVE-2026-1\): "id" must be a GHSA id/);
    assert.match(problems[1], /"reason"/);
    assert.match(problems[2], /"until"/);
    assert.match(problems[3], /entry 4 is not an object/);
  });

  it('rejects a document without an entries array', () => {
    assert.deepEqual(parseAllowlist([]), { entries: [], problems: ['the allowlist has no "entries" array'] });
    assert.deepEqual(parseAllowlist(null).entries, []);
  });
});

describe('isActive', () => {
  it('applies through the end of the until day in UTC', () => {
    assert.equal(isActive(entry(BRACES, '2026-10-05'), new Date('2026-10-05T23:59:59Z')), true);
    assert.equal(isActive(entry(BRACES, '2026-10-05'), new Date('2026-10-06T00:00:00Z')), false);
  });
});

describe('ghsaId and advisoryIds', () => {
  it('reads the id from an advisory URL', () => {
    assert.equal(ghsaId(`https://github.com/advisories/${BRACES}`), BRACES);
    assert.equal(ghsaId('https://example.com'), null);
  });

  it('follows packages that are only vulnerable through a dependency', () => {
    assert.deepEqual(advisoryIds(report.vulnerabilities, 'http-proxy-middleware'), [BRACES]);
  });

  it('marks advisories without a GHSA id as unknown, so they can never be allowlisted', () => {
    const vulnerabilities = { x: { severity: 'high', via: [{ title: 'no url' }] }, y: { severity: 'high', via: ['z'] } };

    assert.deepEqual(advisoryIds(vulnerabilities, 'x'), ['UNKNOWN:no url']);
    assert.deepEqual(advisoryIds(vulnerabilities, 'y'), ['UNKNOWN:z']);
  });

  it('stops on cycles', () => {
    const vulnerabilities = { a: { severity: 'high', via: ['b'] }, b: { severity: 'high', via: ['a'] } };

    assert.deepEqual(advisoryIds(vulnerabilities, 'a'), []);
  });
});

describe('evaluate', () => {
  it('fails on findings at or above the level that the allowlist does not cover', () => {
    const result = evaluate(report, [entry(BRACES)], { now });

    assert.equal(result.failed, true);
    assert.deepEqual(
      result.findings.map((finding) => [finding.name, finding.blocking]),
      [
        ['braces', []],
        ['micromatch', []],
        ['http-proxy-middleware', []],
        ['http-cache-semantics', [CACHE]],
      ],
    );
  });

  it('passes when every finding is allowlisted, and ignores lower severities', () => {
    const result = evaluate(report, [entry(BRACES), entry(CACHE)], { now });

    assert.equal(result.failed, false);
    assert.equal(result.findings.length, 4);
    assert.deepEqual(result.findings[0].allowed, [entry(BRACES)]);
  });

  it('does not apply an expired entry, and reports it', () => {
    const result = evaluate(report, [entry(BRACES, '2026-10-04'), entry(CACHE)], { now });

    assert.equal(result.failed, true);
    assert.deepEqual(result.findings[0].blocking, [BRACES]);
    assert.deepEqual(result.findings[0].expired, [entry(BRACES, '2026-10-04')]);
  });

  it('honours the level', () => {
    assert.equal(evaluate(report, [entry(BRACES), entry(CACHE)], { level: 'moderate', now }).failed, true);
    assert.equal(evaluate(report, [], { level: 'critical', now }).failed, false);
    assert.throws(() => evaluate(report, [], { level: 'severe' }), /Unknown audit level/);
  });

  it('passes a report without vulnerabilities', () => {
    assert.deepEqual(evaluate({ vulnerabilities: {} }, [], { now }), { failed: false, findings: [] });
  });
});

describe('audit-allowlist.json', () => {
  it('is valid: every entry has a GHSA id, a reason and an until date', () => {
    const doc = JSON.parse(readFileSync(new URL('../../audit-allowlist.json', import.meta.url), 'utf8'));
    const { entries, problems } = parseAllowlist(doc);

    assert.deepEqual(problems, []);
    assert.equal(entries.length, doc.entries.length);
    assert.equal(new Set(entries.map((e) => e.id)).size, entries.length, 'ids are unique');
  });
});
