// Production release notes for the CHANGELOG entry of a release pull request.
//
// Sources are tried in order until one succeeds (default: ai, github,
// conventional). The ai source tries the AI providers in their configured
// order (ai-providers.mjs). Every skipped or failed source or provider adds a
// warning, which the release workflow surfaces in the pull request so
// reviewers know what they are looking at. The conventional-commit notes need
// no network and always work, so the chain never leaves a release without
// notes.

import { parseCommit } from './commits.mjs';
import { generateAiNotes, redactSecrets } from './ai-notes.mjs';
import { AI_PROVIDERS } from './ai-providers.mjs';
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
  providers = AI_PROVIDERS,
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
    let detail = null;

    try {
      if (source === 'ai') {
        const keyed = providers.filter((provider) => env[provider.keyEnv]);

        if (keyed.length === 0) {
          const names = providers.map((provider) => provider.keyEnv).join(', ');

          warnings.push(`No AI provider key is set (${names}), so AI release notes were skipped.`);
          continue;
        }

        const diff = includeDiff ? readDiff(range, cwd) : '';

        for (const provider of keyed) {
          try {
            const result = await generateAiNotes({
              provider,
              apiKey: env[provider.keyEnv],
              model,
              repo: env.GITHUB_REPOSITORY,
              version,
              commits,
              diff,
              fetchImpl,
              retryDelayMs,
            });

            warnings.push(...result.warnings.map((warning) => `${provider.label}: ${warning}`));
            body = result.notes;
            detail = `${provider.label}, ${result.model}`;
            break;
          } catch (error) {
            warnings.push(`${provider.label} release notes failed: ${error.message}`);
          }
        }

        if (body === undefined) continue;
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
    // `detail` names the AI provider and model that wrote the notes.
    return { section: `${heading}\n\n${body.trim()}\n`, source, detail, warnings: warnings.map(redactSecrets) };
  }

  throw new Error(redactSecrets(`No release notes source succeeded. ${warnings.join(' ')}`));
}
