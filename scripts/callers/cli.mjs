#!/usr/bin/env node

// CLI for the drift-sync workflow.
//
//   resolve-release [--version vX.Y.Z]
//       Outputs: version, sha (the commit the tag points to).
//   sync --repo owner/name --sha <sha> --version vX.Y.Z [--templates-dir templates] [--dry-run]
//       Needs $GH_TOKEN (the GitHub App token for that repository).
//       Outputs: status (not-installed, in-sync, drift, updated), pull-request.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadTemplatesFromDir, resolveRelease } from './source.mjs';
import { createClient, syncRepository } from './sync.mjs';

function writeOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;

  for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value ?? ''}\n`);
}

const COMMANDS = {
  'resolve-release': {
    options: { version: { type: 'string' } },
    async run(values) {
      const release = resolveRelease({ requested: values.version || undefined });

      writeOutputs(release);
      console.log(`${release.version} ${release.sha}`);
    },
  },

  sync: {
    options: {
      repo: { type: 'string' },
      sha: { type: 'string' },
      version: { type: 'string' },
      'templates-dir': { type: 'string', default: 'templates' },
      'dry-run': { type: 'boolean', default: false },
    },
    async run(values) {
      for (const name of ['repo', 'sha', 'version']) if (!values[name]) throw new Error(`--${name} is required`);
      if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');

      const result = await syncRepository({
        request: createClient({ token: process.env.GH_TOKEN, apiUrl: process.env.GITHUB_API_URL || undefined }),
        repo: values.repo,
        templates: loadTemplatesFromDir(resolve(values['templates-dir'])),
        pin: { sha: values.sha, version: values.version },
        dryRun: values['dry-run'],
        log: console.log,
      });

      writeOutputs({ status: result.status, 'pull-request': result.pr });

      if (process.env.GITHUB_STEP_SUMMARY) {
        const detail = result.pr ?? (result.files.length > 0 ? result.files.join(', ') : '');

        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `| ${values.repo} | ${result.status} | ${detail} |\n`);
      }
    },
  },
};

export async function main(argv = process.argv.slice(2)) {
  const [name, ...rest] = argv;
  const command = COMMANDS[name];

  if (!command) {
    process.stderr.write(`Usage: node scripts/callers/cli.mjs <${Object.keys(COMMANDS).join('|')}> [options]\n`);

    return 2;
  }

  try {
    const { values } = parseArgs({ args: rest, options: command.options, strict: true, allowPositionals: false });

    await command.run(values);

    return 0;
  } catch (error) {
    const message = error.message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

    process.stderr.write(process.env.GITHUB_ACTIONS === 'true' ? `::error::${message}\n` : `error: ${error.message}\n`);

    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
