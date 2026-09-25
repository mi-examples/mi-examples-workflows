// GitHub-generated release notes (the "What's Changed" list of merged pull
// requests), used when AI notes are unavailable. The tag doesn't need to exist
// yet: GitHub generates the notes for `target_commitish`.

// owner/name, where neither part is only dots (no path traversal).
const REPOSITORY_RE = /^(?!\.+\/)[A-Za-z0-9_.-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/;

// Demotes H1/H2 headings to H3, below our `## <version>` heading, and drops the "Full
// Changelog" line, which duplicates the compare link in that heading.
export function tidyGithubNotes(body) {
  return String(body ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\*\*Full Changelog\*\*/.test(line.trim()))
    .map((line) => line.replace(/^#{1,2} /, '### '))
    .join('\n')
    .trim();
}

export async function githubNotes({
  apiUrl = 'https://api.github.com',
  repository,
  token,
  tagName,
  target,
  previousTag,
  fetchImpl = fetch,
}) {
  if (!REPOSITORY_RE.test(repository ?? '')) throw new Error(`invalid repository: ${repository}`);

  const response = await fetchImpl(`${apiUrl}/repos/${repository}/releases/generate-notes`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ tag_name: tagName, target_commitish: target, previous_tag_name: previousTag }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);

    throw new Error(`GitHub generate-notes failed: ${response.status} ${detail}`.trim());
  }

  const notes = tidyGithubNotes((await response.json()).body);

  if (!notes) throw new Error('GitHub generated empty release notes');

  return notes;
}
