#!/usr/bin/env node

// Release tooling for the shared release workflows. Zero dependencies.
//
//   next-version        Next production version from commits since the last vX.Y.Z tag.
//   next-beta           Next X.Y.Z-beta.N for the same commits.
//   release-status      Whether the package.json version on main still needs releasing.
//   notes               Conventional-commit notes for a version.
//   release-notes       CHANGELOG section for a production release: AI notes, with
//                       GitHub-generated and conventional-commit notes as fallbacks.
//   changelog-insert    Insert (or replace) a version section at the top of CHANGELOG.md.
//   changelog-extract   Print one version's section, e.g. for a GitHub release body.
//
// Primary results go to stdout; every result is also written to
// $GITHUB_OUTPUT when it is set. Run with --help for the options.

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { DEFAULT_MODEL } from './ai-notes.mjs';
import { extractSection, insertSection } from './changelog.mjs';
import { parseCommit } from './commits.mjs';
import { readCommits } from './git.mjs';
import { renderNotes, today } from './notes.mjs';
import { buildReleaseNotes, SOURCES } from './release-notes.mjs';
import { lastRelease, nextBeta, nextVersion, releaseStatus } from './versions.mjs';

const USAGE = `Usage: node scripts/release/cli.mjs <command> [options]

Commands:
  next-version [--ref HEAD]
      Outputs: release, version, level, last-tag
  next-beta [--ref HEAD]
      Outputs: release, version, base-version, level, last-tag, previous-tag, already-tagged
  release-status [--ref HEAD]
      State of the package.json version: new, released, prerelease (exit 0) or stale (exit 1).
      Outputs: state, version, tag, tag-exists, last-tag
  notes --version <v> [--from <tag>] [--to HEAD] [--repo-url <url>] [--date YYYY-MM-DD] [--output <file>]
      --from defaults to the last production tag reachable from --to.
      --repo-url defaults to $GITHUB_SERVER_URL/$GITHUB_REPOSITORY.
  release-notes --version <v> [--from <tag>] [--to HEAD] [--repo-url <url>] [--date YYYY-MM-DD] [--output <file>]
                [--model ${DEFAULT_MODEL}] [--sources ${SOURCES.join(',')}] [--no-diff]
      Tries each source in order: ai needs $OPENAI_API_KEY, github needs $GITHUB_TOKEN and $GITHUB_REPOSITORY.
      Outputs: source, warnings
  changelog-insert --version <v> --notes-file <file> [--file CHANGELOG.md]
  changelog-extract --version <v> [--file CHANGELOG.md] [--with-heading] [--output <file>]
`;

// Escaped per the workflow-command format, so a message can't start a new command.
function escapeCommand(message) {
  return message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function warn(message) {
  if (process.env.GITHUB_ACTIONS === 'true') process.stderr.write(`::warning::${escapeCommand(message)}\n`);
  else process.stderr.write(`warning: ${message}\n`);
}

function writeOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT;

  if (!file) return;

  for (const [key, value] of Object.entries(outputs)) {
    const text = value === null || value === undefined ? '' : String(value);

    if (text.includes('\n')) {
      const delimiter = `EOF_${randomUUID()}`;

      appendFileSync(file, `${key}<<${delimiter}\n${text}\n${delimiter}\n`);
    } else {
      appendFileSync(file, `${key}=${text}\n`);
    }
  }
}

function emit(text, output) {
  if (output) writeFileSync(output, text);
  else process.stdout.write(text);
}

function defaultRepoUrl() {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository } = process.env;

  return server && repository ? `${server}/${repository}` : null;
}

function required(values, name) {
  if (!values[name]) throw new Error(`--${name} is required`);

  return values[name];
}

const COMMANDS = {
  'next-version': {
    options: { ref: { type: 'string', default: 'HEAD' } },
    run(values) {
      const result = nextVersion({ ref: values.ref });

      writeOutputs({
        release: Boolean(result.version),
        version: result.version,
        level: result.level,
        'last-tag': result.lastTag,
      });

      if (result.version) console.log(result.version);
      else console.error(`No release: no releasable commits since ${result.lastTag}.`);
    },
  },

  'next-beta': {
    options: { ref: { type: 'string', default: 'HEAD' } },
    run(values) {
      const result = nextBeta({ ref: values.ref });

      writeOutputs({
        release: Boolean(result.version),
        version: result.version,
        'base-version': result.baseVersion,
        level: result.level,
        'last-tag': result.lastTag,
        'previous-tag': result.previousTag,
        'already-tagged': result.alreadyTagged,
      });

      if (result.version) console.log(result.version);
      else console.error(`No release: no releasable commits since ${result.previousTag ?? result.lastTag}.`);
    },
  },

  'release-status': {
    options: { ref: { type: 'string', default: 'HEAD' } },
    run(values) {
      const result = releaseStatus({ ref: values.ref });

      writeOutputs({
        state: result.state,
        version: result.version,
        tag: result.tag,
        'tag-exists': result.tagExists,
        'last-tag': result.lastTag,
      });

      if (result.state === 'stale') {
        throw new Error(
          `package.json on ${values.ref} says ${result.version}, which is not newer than ${result.lastTag} and has no tag. ` +
            'Bump the version through a release pull request.',
        );
      }

      console.log(result.state);
    },
  },

  notes: {
    options: {
      version: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string', default: 'HEAD' },
      'repo-url': { type: 'string' },
      date: { type: 'string' },
      output: { type: 'string' },
    },
    run(values) {
      const version = required(values, 'version').replace(/^v/, '');
      const from = values.from ?? lastRelease({ ref: values.to })?.tag;

      if (!from) throw new Error(`--from is required: no production tag is reachable from ${values.to}`);

      const commits = readCommits(`${from}..${values.to}`).map(parseCommit);
      const notes = renderNotes({
        version,
        previousTag: from,
        commits,
        repoUrl: values['repo-url'] ?? defaultRepoUrl(),
        date: values.date ?? today(),
      });

      emit(notes, values.output);
    },
  },

  'release-notes': {
    options: {
      version: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string', default: 'HEAD' },
      'repo-url': { type: 'string' },
      date: { type: 'string' },
      output: { type: 'string' },
      model: { type: 'string', default: DEFAULT_MODEL },
      sources: { type: 'string', default: SOURCES.join(',') },
      'no-diff': { type: 'boolean', default: false },
    },
    async run(values) {
      const version = required(values, 'version').replace(/^v/, '');
      const from = values.from ?? lastRelease({ ref: values.to })?.tag;

      if (!from) throw new Error(`--from is required: no production tag is reachable from ${values.to}`);

      const sources = values.sources.split(',').map((source) => source.trim()).filter(Boolean);
      const unknown = sources.filter((source) => !SOURCES.includes(source));

      if (sources.length === 0 || unknown.length > 0) {
        throw new Error(`--sources must be a comma-separated subset of ${SOURCES.join(',')}`);
      }

      const result = await buildReleaseNotes({
        version,
        from,
        to: values.to,
        repoUrl: values['repo-url'] ?? defaultRepoUrl(),
        date: values.date ?? today(),
        sources,
        model: values.model,
        includeDiff: !values['no-diff'],
      });

      for (const warning of result.warnings) warn(warning);

      writeOutputs({ source: result.source, warnings: result.warnings.join('\n') });
      emit(result.section, values.output);
    },
  },

  'changelog-insert': {
    options: {
      version: { type: 'string' },
      'notes-file': { type: 'string' },
      file: { type: 'string', default: 'CHANGELOG.md' },
    },
    run(values) {
      const version = required(values, 'version');
      const section = readFileSync(required(values, 'notes-file'), 'utf8');
      const current = existsSync(values.file) ? readFileSync(values.file, 'utf8') : '';

      writeFileSync(values.file, insertSection(current, section, version));
      console.error(`Updated ${values.file} with ${version}.`);
    },
  },

  'changelog-extract': {
    options: {
      version: { type: 'string' },
      file: { type: 'string', default: 'CHANGELOG.md' },
      'with-heading': { type: 'boolean', default: false },
      output: { type: 'string' },
    },
    run(values) {
      const version = required(values, 'version');
      const section = extractSection(readFileSync(values.file, 'utf8'), version, {
        withHeading: values['with-heading'],
      });

      if (section === null) throw new Error(`No section for ${version} in ${values.file}`);

      emit(section, values.output);
    },
  },
};

export async function main(argv = process.argv.slice(2)) {
  const [name, ...rest] = argv;

  if (!name || name === '--help' || name === '-h') {
    process.stdout.write(USAGE);

    return 0;
  }

  const command = COMMANDS[name];

  if (!command) {
    process.stderr.write(`Unknown command: ${name}\n\n${USAGE}`);

    return 2;
  }

  try {
    const { values } = parseArgs({ args: rest, options: command.options, strict: true, allowPositionals: false });

    await command.run(values);

    return 0;
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === 'true') process.stderr.write(`::error::${escapeCommand(error.message)}\n`);
    else process.stderr.write(`error: ${error.message}\n`);

    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
