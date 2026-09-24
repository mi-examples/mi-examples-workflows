// Conventional-commit parsing and release-level rules.
//
// The rules match the angular preset with the default commit-analyzer rules
// that the package repos used with semantic-release:
//   feat → minor; fix, perf, revert → patch; a BREAKING CHANGE footer → major;
//   every other type → no release.
// One intentional addition: `type!:` (and `type(scope)!:`) also means major.

const HEADER_RE = /^(\w+)(?:\(([^)]*)\))?(!)?: (.+)$/;
const GIT_REVERT_RE = /^Revert "(.+)"$/;
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGES?:[ \t]*(.*)$/;

const LEVEL_BY_TYPE = { feat: 'minor', fix: 'patch', perf: 'patch', revert: 'patch' };
const LEVEL_RANK = { patch: 1, minor: 2, major: 3 };

// Returns the text of a BREAKING CHANGE footer: its first line plus the
// following lines up to the next blank line. `null` when there is none.
function breakingFooter(body) {
  const lines = String(body ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => BREAKING_FOOTER_RE.test(line));

  if (start === -1) return null;

  const text = [BREAKING_FOOTER_RE.exec(lines[start])[1]];

  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    text.push(line.trim());
  }

  return text.join(' ').trim();
}

export function parseCommit({ hash, subject, body = '' }) {
  const header = String(subject ?? '').trim();
  const match = HEADER_RE.exec(header);
  let type = null;
  let scope = null;
  let description = header;
  let bang = false;

  if (match) {
    type = match[1].toLowerCase();
    scope = match[2]?.trim() || null;
    bang = Boolean(match[3]);
    description = match[4].trim();
  } else {
    const revert = GIT_REVERT_RE.exec(header);

    if (revert) {
      type = 'revert';
      description = revert[1];
    }
  }

  const footer = breakingFooter(body);
  const breaking = bang || footer !== null;

  return {
    hash,
    type,
    scope,
    description,
    breaking,
    breakingNote: breaking ? footer || description : null,
  };
}

// Highest release level across the commits: 'major', 'minor', 'patch', or
// null when nothing triggers a release.
export function releaseLevel(commits) {
  let level = null;

  for (const commit of commits) {
    const own = commit.breaking ? 'major' : (LEVEL_BY_TYPE[commit.type] ?? null);

    if (own && (!level || LEVEL_RANK[own] > LEVEL_RANK[level])) level = own;
  }

  return level;
}
