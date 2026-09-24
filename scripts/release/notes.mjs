// Conventional-commit release notes, grouped by type. Used for beta
// prereleases and as the fallback when AI release notes are unavailable.

// Same types as the `commitTypes` the package repos configured for
// semantic-release, in the order they appear in the notes.
const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance Improvements'],
  ['revert', 'Reverts'],
  ['docs', 'Documentation'],
  ['style', 'Styles'],
  ['refactor', 'Code Refactoring'],
  ['test', 'Tests'],
  ['build', 'Build System'],
  ['ci', 'Continuous Integration'],
  ['chore', 'Chores'],
];

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function entry(text, scope, hash, repoUrl) {
  const prefix = scope ? `**${scope}:** ` : '';
  const link = hash ? (repoUrl ? ` ([${hash.slice(0, 7)}](${repoUrl}/commit/${hash}))` : ` (${hash.slice(0, 7)})`) : '';

  return `* ${prefix}${text}${link}`;
}

export function renderHeading({ version, previousTag, repoUrl, date = today() }) {
  const title = repoUrl && previousTag ? `[${version}](${repoUrl}/compare/${previousTag}...v${version})` : version;

  return `## ${title} (${date})`;
}

// `commits` are parsed commits (see commits.mjs), newest first. Commits
// without a conventional type are left out.
export function renderNotes({ version, previousTag, commits, repoUrl, date = today() }) {
  const lines = [renderHeading({ version, previousTag, repoUrl, date }), ''];
  const breaking = commits.filter((commit) => commit.breaking);

  if (breaking.length > 0) {
    lines.push('### ⚠ BREAKING CHANGES', '');
    for (const commit of breaking) lines.push(entry(commit.breakingNote, commit.scope, null, repoUrl));
    lines.push('');
  }

  let sections = 0;

  for (const [type, title] of SECTIONS) {
    const matching = commits.filter((commit) => commit.type === type);

    if (matching.length === 0) continue;

    sections += 1;
    lines.push(`### ${title}`, '');
    for (const commit of matching) lines.push(entry(commit.description, commit.scope, commit.hash, repoUrl));
    lines.push('');
  }

  if (sections === 0 && breaking.length === 0) lines.push('No notable changes.', '');

  return `${lines.join('\n').trimEnd()}\n`;
}
