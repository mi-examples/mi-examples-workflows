// CHANGELOG.md editing: insert or replace one version's section at the top,
// and extract a section for the GitHub release body.
//
// Version headings written by semantic-release (`# [1.2.0-beta.1](...)`,
// `## [1.1.1](...)`), by Keep a Changelog (`## [0.10.0] - 2024-03-21`) and by
// our notes (`## [1.2.0](...) (2026-09-24)`) are all recognized, so existing
// changelogs keep working.

const VERSION_HEADING_RE = /^#{1,3} \[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?=[\s(]|$)/;
const TITLE = '# Changelog';

function headingVersion(line) {
  return VERSION_HEADING_RE.exec(line)?.[1] ?? null;
}

// Line range [start, end) of the section for `version`, or null.
function findSection(lines, version) {
  const wanted = version.replace(/^v/, '');
  const start = lines.findIndex((line) => headingVersion(line) === wanted);

  if (start === -1) return null;

  const next = lines.findIndex((line, index) => index > start && headingVersion(line) !== null);

  return { start, end: next === -1 ? lines.length : next };
}

export function extractSection(text, version, { withHeading = false } = {}) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const range = findSection(lines, version);

  if (!range) return null;

  const body = lines.slice(withHeading ? range.start : range.start + 1, range.end).join('\n').trim();

  return body ? `${body}\n` : '';
}

// `section` is a full section including its version heading. A section that
// already exists for the same version is replaced, so re-running a release
// preparation doesn't duplicate it.
export function insertSection(text, section, version) {
  const sectionLines = String(section).replace(/\r\n/g, '\n').trim().split('\n');
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const existing = findSection(lines, version);

  if (existing) {
    lines.splice(existing.start, existing.end - existing.start, ...sectionLines, '');
  } else {
    const first = lines.findIndex((line) => line.trim());
    const hasTitle = first !== -1 && /^# /.test(lines[first]) && headingVersion(lines[first]) === null;

    if (hasTitle) {
      let insertAt = first + 1;

      while (insertAt < lines.length && !lines[insertAt].trim()) insertAt += 1;
      lines.splice(first + 1, insertAt - first - 1, '', ...sectionLines, '');
    } else {
      lines.splice(0, first === -1 ? lines.length : first, TITLE, '', ...sectionLines, '');
    }
  }

  // Only the inserted section's surroundings are normalized; older entries are
  // left byte-for-byte as they were.
  return `${lines.join('\n').trimEnd()}\n`;
}
