// Production release notes for the CHANGELOG entry of a release pull request.
//
// Sources are tried in order until one succeeds (default: ai, github,
// conventional). Every skipped or failed source adds a warning, which the
// release workflow surfaces in the pull request so reviewers know what they
// are looking at. The conventional-commit notes need no network and always
// work, so the chain never leaves a release without notes.

import { parseCommit } from './commits.mjs';
import { generateAiNotes, redactSecrets } from './ai-notes.mjs';
import { readCommits, readDiff, resolveRef } from './git.mjs';
import { githubNotes } from './github-notes.mjs';
import { renderHeading, renderNotesBody, today } from './notes.mjs';

export const SOURCES = ['ai', 'github', 'conventional'];

export async function buildReleaseNotes({
  cwd,
  version,
  from,
  to = 'HEAD',
  repoUrl,
  date = today(),
  sources = SOURCES,
  model,
  includeDiff = true,
  env = process.env,
  fetchImpl = fetch,
  retryDelayMs,
}) {
  const range = `${from}..${to}`;
  const commits = readCommits(range, cwd).map((raw) => ({ ...parseCommit(raw), subject: raw.subject, body: raw.body }));
  const heading = renderHeading({ version, previousTag: from, repoUrl, date });
  const warnings = [];

  for (const source of sources) {
    let body;

    try {
      if (source === 'ai') {
        if (!env.OPENAI_API_KEY) {
          warnings.push('OPENAI_API_KEY is not set, so AI release notes were skipped.');
          continue;
        }

        const result = await generateAiNotes({
          apiKey: env.OPENAI_API_KEY,
          model,
          repo: env.GITHUB_REPOSITORY,
          version,
          commits,
          diff: includeDiff ? readDiff(range, cwd) : '',
          url: env.OPENAI_API_URL || undefined,
          fetchImpl,
          retryDelayMs,
        });

        warnings.push(...result.warnings);
        body = result.notes;
      } else if (source === 'github') {
        if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) {
          warnings.push('GITHUB_TOKEN or GITHUB_REPOSITORY is not set, so GitHub-generated notes were skipped.');
          continue;
        }

        body = await githubNotes({
          apiUrl: env.GITHUB_API_URL || undefined,
          repository: env.GITHUB_REPOSITORY,
          token: env.GITHUB_TOKEN,
          tagName: `v${version}`,
          target: resolveRef(to, cwd),
          previousTag: from,
          fetchImpl,
        });
      } else if (source === 'conventional') {
        body = renderNotesBody({ commits, repoUrl });
      } else {
        throw new Error(`unknown source "${source}"`);
      }
    } catch (error) {
      warnings.push(`${source} release notes failed: ${error.message}`);
      continue;
    }

    // Warnings end up in a public pull request, and API errors can echo
    // fragments of credentials.
    return { section: `${heading}\n\n${body.trim()}\n`, source, warnings: warnings.map(redactSecrets) };
  }

  throw new Error(redactSecrets(`No release notes source succeeded. ${warnings.join(' ')}`));
}
