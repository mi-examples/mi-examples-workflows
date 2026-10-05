// The shared npm audit allowlist: advisories that have no upstream fix and are known to be unreachable or
// acceptable. It lives in audit-allowlist.json on main, and the audit reads it on every run, so an entry
// reaches every package repository without a release. Zero dependencies.

export const DEFAULT_ALLOWLIST_URL =
  'https://raw.githubusercontent.com/mi-examples/mi-examples-workflows/main/audit-allowlist.json';

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

const GHSA_ID = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates an allowlist document. Invalid entries are dropped and reported, so one bad entry doesn't
 * hide the others, and can't suppress anything.
 *
 * @returns {{ entries: Array<{ id: string; reason: string; until: string }>; problems: string[] }}
 */
export function parseAllowlist(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.entries)) {
    return { entries: [], problems: ['the allowlist has no "entries" array'] };
  }

  const entries = [];
  const problems = [];

  doc.entries.forEach((entry, index) => {
    const where = `entry ${index + 1}`;

    if (!entry || typeof entry !== 'object') {
      problems.push(`${where} is not an object`);

      return;
    }

    const { id, reason, until } = entry;
    const errors = [];

    if (typeof id !== 'string' || !GHSA_ID.test(id)) {
      errors.push('"id" must be a GHSA id, e.g. GHSA-vfj7-8cjw-p6xm');
    }

    if (typeof reason !== 'string' || !reason.trim()) {
      errors.push('"reason" must say why the advisory is unreachable or acceptable');
    }

    if (typeof until !== 'string' || !ISO_DATE.test(until) || Number.isNaN(Date.parse(`${until}T00:00:00Z`))) {
      errors.push('"until" must be a date (YYYY-MM-DD)');
    }

    if (errors.length > 0) {
      problems.push(`${where}${typeof id === 'string' ? ` (${id})` : ''}: ${errors.join('; ')}`);

      return;
    }

    entries.push({ id, reason: reason.trim(), until });
  });

  return { entries, problems };
}

/** An entry applies through the end of its `until` day, in UTC. */
export function isActive(entry, now = new Date()) {
  return now.toISOString().slice(0, 10) <= entry.until;
}

/** The GHSA id in an advisory URL, as GitHub writes it. */
export function ghsaId(url) {
  const match = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(url ?? '');

  return match ? match[0] : null;
}

/**
 * The advisories a package in an `npm audit --json` report stems from. A package that is only vulnerable
 * through a dependency (`via: ["micromatch"]`) inherits that dependency's advisories.
 */
export function advisoryIds(vulnerabilities, name, seen = new Set()) {
  if (seen.has(name)) {
    return [];
  }

  seen.add(name);

  const entry = vulnerabilities[name];

  if (!entry) {
    return [`UNKNOWN:${name}`];
  }

  const ids = [];

  for (const via of entry.via ?? []) {
    if (typeof via === 'string') {
      ids.push(...advisoryIds(vulnerabilities, via, seen));
    } else {
      ids.push(ghsaId(via.url) ?? `UNKNOWN:${via.title ?? name}`);
    }
  }

  return [...new Set(ids)];
}

/**
 * Checks an `npm audit --json` report (npm 7+) against the allowlist.
 *
 * A finding at or above `level` passes only when every advisory it stems from has an active entry.
 *
 * @returns {{ failed: boolean; findings: Array<{
 *   name: string; severity: string; ids: string[]; blocking: string[];
 *   allowed: Array<{ id: string; reason: string; until: string }>;
 *   expired: Array<{ id: string; reason: string; until: string }>;
 * }> }}
 */
export function evaluate(report, entries, { level = 'high', now = new Date() } = {}) {
  const minimum = SEVERITIES.indexOf(level);

  if (minimum < 0) {
    throw new Error(`Unknown audit level "${level}". Expected one of: ${SEVERITIES.join(', ')}`);
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const vulnerabilities = report?.vulnerabilities ?? {};
  const findings = [];

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (SEVERITIES.indexOf(vulnerability.severity) < minimum) {
      continue;
    }

    const ids = advisoryIds(vulnerabilities, name);
    const allowed = [];
    const expired = [];
    const blocking = [];

    for (const id of ids) {
      const entry = byId.get(id);

      if (entry && isActive(entry, now)) {
        allowed.push(entry);
      } else {
        blocking.push(id);

        if (entry) {
          expired.push(entry);
        }
      }
    }

    findings.push({ name, severity: vulnerability.severity, ids, blocking, allowed, expired });
  }

  return { failed: findings.some((finding) => finding.blocking.length > 0), findings };
}
