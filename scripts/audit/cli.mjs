#!/usr/bin/env node

// npm audit with the shared allowlist. Zero dependencies.
//
// Runs `npm audit --json` in the current directory and fails on findings at or above the level
// (default: high) unless every advisory behind them has an active entry in the allowlist. The
// allowlist is read on every run, by default from audit-allowlist.json on main, so changing it
// needs no release. If it can't be loaded, nothing is allowlisted.
//
//   --level <severity>     info, low, moderate, high (default) or critical
//   --allowlist <source>   URL or file path; "none" turns it off.
//                          Default: $AUDIT_ALLOWLIST_URL, else the shared list on main.
//   --report <file>        Check a saved `npm audit --json` report instead of running npm audit.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { DEFAULT_ALLOWLIST_URL, evaluate, parseAllowlist } from './allowlist.mjs';

const inActions = process.env.GITHUB_ACTIONS === 'true';

function escapeCommand(message) {
  return message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function annotate(kind, message) {
  process.stdout.write(inActions ? `::${kind}::${escapeCommand(message)}\n` : `${kind}: ${message}\n`);
}

function runNpmAudit() {
  // npm is npm.cmd on Windows, which Node only starts through a shell. CI runs on Linux without one.
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm audit --json'], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        })
      : spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  if (result.error) {
    throw result.error;
  }

  if (!result.stdout) {
    throw new Error(`npm audit printed nothing (exit ${result.status}): ${result.stderr}`);
  }

  return result.stdout;
}

async function loadAllowlist(source) {
  if (!source || source === 'none') {
    return { entries: [], problems: [], note: 'off' };
  }

  try {
    let text;

    if (/^https?:\/\//.test(source)) {
      const response = await fetch(source, { signal: AbortSignal.timeout(15_000) });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      text = await response.text();
    } else {
      text = readFileSync(source, 'utf8');
    }

    return { ...parseAllowlist(JSON.parse(text)), note: source };
  } catch (error) {
    // Fail closed: without the list, every finding counts.
    annotate('warning', `Could not load the audit allowlist from ${source} (${error.message}); nothing is allowlisted.`);

    return { entries: [], problems: [], note: `${source} (not loaded)` };
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      level: { type: 'string', default: process.env.AUDIT_LEVEL || 'high' },
      allowlist: { type: 'string', default: process.env.AUDIT_ALLOWLIST_URL || DEFAULT_ALLOWLIST_URL },
      report: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    process.stdout.write(
      'Usage: node scripts/audit/cli.mjs [--level high] [--allowlist <url|path|none>] [--report <file>]\n',
    );

    return 0;
  }

  const report = JSON.parse(values.report ? readFileSync(values.report, 'utf8') : runNpmAudit());

  if (report.error) {
    throw new Error(`npm audit failed: ${report.error.summary ?? report.error.code ?? JSON.stringify(report.error)}`);
  }

  const allowlist = await loadAllowlist(values.allowlist);

  for (const problem of allowlist.problems) {
    annotate('warning', `Ignored audit allowlist ${problem}`);
  }

  const { failed, findings } = evaluate(report, allowlist.entries, { level: values.level });

  console.log(`npm audit: ${findings.length} finding(s) at ${values.level} or above. Allowlist: ${allowlist.note}.`);

  // One annotation per allowlisted advisory, naming the packages it covered in this report.
  const used = new Map();
  const expired = new Map();

  for (const finding of findings) {
    if (finding.blocking.length === 0) {
      for (const entry of finding.allowed) {
        used.set(entry.id, { entry, packages: [...(used.get(entry.id)?.packages ?? []), finding.name] });
      }
      continue;
    }

    console.log(`  ✗ ${finding.name} (${finding.severity}): ${finding.blocking.join(', ')}`);

    for (const entry of finding.expired) {
      expired.set(entry.id, entry);
    }
  }

  for (const { entry, packages } of used.values()) {
    annotate('warning', `Allowlisted ${entry.id} until ${entry.until} (${packages.join(', ')}): ${entry.reason}`);
  }

  for (const entry of expired.values()) {
    annotate('error', `The audit allowlist entry for ${entry.id} expired on ${entry.until}, so it applies no more.`);
  }

  if (failed) {
    console.log('Fix them, or, if one has no fix and is unreachable, add it to audit-allowlist.json in mi-examples-workflows.');

    return 1;
  }

  console.log('✓ no unresolved findings');

  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    annotate('error', error.message);
    process.exitCode = 1;
  },
);
