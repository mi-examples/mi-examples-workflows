#!/usr/bin/env node

// Renders every caller template twice, with every input group set and with
// no inputs, so CI can lint the files package repositories actually get:
//
//   node scripts/callers/render-fixture.mjs <out-dir>
//
// Writes <out-dir>/{with-inputs,defaults}/.github/workflows/*.yml.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CALLERS, renderAll } from './render.mjs';
import { loadTemplatesFromDir } from './source.mjs';

// A real release, so online audits can resolve the pinned workflows.
const PIN = { sha: 'cf845c043bfdebca3b0db0df24cb8e0a6aa71dc6', version: 'v0.5.0' };

const INPUTS = {
  ci: { 'dist-dir': 'dist', 'extra-scripts': 'test:e2e\ntest:e2e:browser', 'free-disk-space': true, 'timeout-minutes': 30 },
  'secret-scan': { 'full-history': false },
  'dependency-audit': { 'audit-command': 'npm run audit:all' },
  publish: { 'build-script': 'build:component', test: false },
  prepare: { model: 'gpt-5-mini' },
  'main-ahead-check': { mode: 'warn' },
};

const out = process.argv[2];

if (!out) {
  console.error('Usage: node scripts/callers/render-fixture.mjs <out-dir>');
  process.exit(2);
}

const templates = loadTemplatesFromDir(join(dirname(fileURLToPath(import.meta.url)), '../../templates'));
const callers = Object.keys(CALLERS);

for (const [variant, inputs] of [['with-inputs', INPUTS], ['defaults', {}]]) {
  for (const [path, content] of renderAll(templates, { callers, inputs }, PIN)) {
    const target = join(out, variant, path);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

console.log(`Rendered ${callers.length} callers twice into ${out}.`);
