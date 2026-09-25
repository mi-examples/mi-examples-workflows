// Renders the caller workflows that a package repository gets from this
// repository. The npx installer and drift sync share this module, so a
// caller is either exactly what render produces or it has drifted.
//
// A package repository keeps its own settings in CONFIG_PATH:
//
//   {
//     "callers": ["ci", "secret-scan", "dependency-audit", "release", "main-ahead-check"],
//     "inputs": { "ci": { "dist-dir": "dist" }, "publish": { "build-script": "build" } }
//   }
//
// `inputs` groups map to the `{{with:<group>}}` and `{{inputs:<group>}}`
// placeholders in templates/*.yml. Values are strings, numbers or booleans.

export const CONFIG_PATH = '.github/mi-examples-workflows.json';

export const CALLERS = {
  ci: 'ci.yml',
  'secret-scan': 'secret-scan.yml',
  'dependency-audit': 'dependency-audit.yml',
  release: 'release.yml',
  'main-ahead-check': 'main-ahead-check.yml',
};

export const BASE_CALLERS = ['ci', 'secret-scan', 'dependency-audit'];

const HEADER = [
  '# Managed by mi-examples-workflows. Do not edit by hand: change',
  `# ${CONFIG_PATH} and re-run \`npx github:mi-examples/mi-examples-workflows\`,`,
  '# or merge the sync pull request.',
  '',
  '',
].join('\n');

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const VERSION_RE = /^v\d+\.\d+\.\d+$/;
const BLOCK_RE = /^( *)\{\{(with|inputs):([a-z][a-z0-9-]*)\}\}\n/gm;

export function callerPath(name) {
  return `.github/workflows/${CALLERS[name]}`;
}

// Input groups a template accepts, from its placeholders.
export function inputGroups(template) {
  return [...template.matchAll(BLOCK_RE)].map((match) => match[3]);
}

function renderValue(value, where) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);

  throw new Error(`${where}: values must be strings, numbers or booleans`);
}

function renderBlock(indent, kind, group, inputs) {
  const entries = Object.entries(inputs[group] ?? {});

  if (entries.length === 0) return '';

  const lines = entries.map(([key, value]) => `${indent}${kind === 'with' ? '  ' : ''}${key}: ${renderValue(value, `inputs.${group}.${key}`)}`);

  return `${kind === 'with' ? `${indent}with:\n` : ''}${lines.join('\n')}\n`;
}

export function validateConfig(config, templates) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${CONFIG_PATH} must be a JSON object`);

  const callers = config.callers ?? [];

  if (!Array.isArray(callers) || callers.length === 0) throw new Error(`${CONFIG_PATH}: "callers" must list at least one caller`);

  for (const name of callers) {
    if (!CALLERS[name]) throw new Error(`${CONFIG_PATH}: unknown caller "${name}" (known: ${Object.keys(CALLERS).join(', ')})`);
  }

  const inputs = config.inputs ?? {};

  if (typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error(`${CONFIG_PATH}: "inputs" must be an object`);

  const groups = new Set(callers.flatMap((name) => inputGroups(templates[name] ?? '')));

  for (const [group, values] of Object.entries(inputs)) {
    if (!groups.has(group)) {
      throw new Error(`${CONFIG_PATH}: inputs group "${group}" isn't used by the listed callers (used: ${[...groups].join(', ') || 'none'})`);
    }

    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`${CONFIG_PATH}: inputs.${group} must be an object`);

    for (const [key, value] of Object.entries(values)) {
      if (!NAME_RE.test(key)) throw new Error(`${CONFIG_PATH}: invalid input name inputs.${group}.${key}`);
      renderValue(value, `inputs.${group}.${key}`);
    }
  }

  return { callers: [...new Set(callers)], inputs };
}

export function renderCaller(template, { sha, version, inputs = {} }) {
  if (!SHA_RE.test(sha)) throw new Error(`invalid commit SHA: ${sha}`);
  if (!VERSION_RE.test(version)) throw new Error(`invalid version: ${version}`);

  const body = template
    .replace(/\r\n/g, '\n')
    .replace(BLOCK_RE, (_, indent, kind, group) => renderBlock(indent, kind, group, inputs))
    .replaceAll('{{sha}}', sha)
    .replaceAll('{{version}}', version);

  if (/\{\{(sha|version|with:|inputs:)/.test(body)) throw new Error('template has an unrendered placeholder');

  return `${HEADER}${body.trimEnd()}\n`;
}

// Map of repository path → file content for every caller in `config`.
export function renderAll(templates, config, pin) {
  const { callers, inputs } = validateConfig(config, templates);

  return new Map(callers.map((name) => [callerPath(name), renderCaller(templates[name], { ...pin, inputs })]));
}

export function renderConfig(config) {
  const { callers, inputs } = config;
  const ordered = Object.keys(CALLERS).filter((name) => callers.includes(name));

  return `${JSON.stringify({ callers: ordered, inputs }, null, 2)}\n`;
}
