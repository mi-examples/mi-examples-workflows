// Renders the caller workflows that a package repository gets from this
// repository. The npx installer and drift sync share this module, so a
// caller is either exactly what render produces or it has drifted.
//
// A package repository keeps its own settings in CONFIG_PATH:
//
//   {
//     "callers": ["ci", "secret-scan", "dependency-audit", "release", "main-ahead-check"],
//     "inputs": { "ci": { "dist-dir": "dist" }, "publish": { "build-script": "build" } },
//     "secrets": { "ci": { "ssh-private-key": "DEPLOY_KEY" } }
//   }
//
// `inputs` groups map to the `{{with:<group>}}` and `{{inputs:<group>}}`
// placeholders in templates/*.yml. Values are strings, numbers or booleans.
// `secrets` groups map to `{{secrets:<group>}}`. Each value names a secret of
// the package repository, passed as `<key>: ${{ secrets.<NAME> }}`.

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
const SECRET_NAME_RE = /^(?!GITHUB_)[A-Z_][A-Z0-9_]*$/;
const BLOCK_RE = /^( *)\{\{(with|inputs|secrets):([a-z][a-z0-9-]*)\}\}\n/gm;

export function callerPath(name) {
  return `.github/workflows/${CALLERS[name]}`;
}

// Input groups a template accepts, from its placeholders.
export function inputGroups(template) {
  return [...template.matchAll(BLOCK_RE)].filter((match) => match[2] !== 'secrets').map((match) => match[3]);
}

// Secret groups a template accepts, from its `{{secrets:<group>}}` placeholders.
export function secretGroups(template) {
  return [...template.matchAll(BLOCK_RE)].filter((match) => match[2] === 'secrets').map((match) => match[3]);
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

function renderSecretsBlock(indent, group, secrets) {
  const entries = Object.entries(secrets[group] ?? {});

  if (entries.length === 0) return '';

  const lines = entries.map(([key, name]) => `${indent}  ${key}: \${{ secrets.${name} }}`);

  return `${indent}secrets:\n${lines.join('\n')}\n`;
}

function validateGroups(section, values, groups) {
  if (typeof values !== 'object' || Array.isArray(values)) throw new Error(`${CONFIG_PATH}: "${section}" must be an object`);

  for (const [group, entries] of Object.entries(values)) {
    if (!groups.has(group)) {
      throw new Error(`${CONFIG_PATH}: ${section} group "${group}" isn't used by the listed callers (used: ${[...groups].join(', ') || 'none'})`);
    }

    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`${CONFIG_PATH}: ${section}.${group} must be an object`);

    for (const key of Object.keys(entries)) {
      if (!NAME_RE.test(key)) throw new Error(`${CONFIG_PATH}: invalid input name ${section}.${group}.${key}`);
    }
  }
}

export function validateConfig(config, templates) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${CONFIG_PATH} must be a JSON object`);

  const callers = config.callers ?? [];

  if (!Array.isArray(callers) || callers.length === 0) throw new Error(`${CONFIG_PATH}: "callers" must list at least one caller`);

  for (const name of callers) {
    if (!CALLERS[name]) throw new Error(`${CONFIG_PATH}: unknown caller "${name}" (known: ${Object.keys(CALLERS).join(', ')})`);
  }

  const inputs = config.inputs ?? {};

  validateGroups('inputs', inputs, new Set(callers.flatMap((name) => inputGroups(templates[name] ?? ''))));

  for (const [group, values] of Object.entries(inputs)) {
    for (const [key, value] of Object.entries(values)) renderValue(value, `inputs.${group}.${key}`);
  }

  const secrets = config.secrets ?? {};

  validateGroups('secrets', secrets, new Set(callers.flatMap((name) => secretGroups(templates[name] ?? ''))));

  for (const [group, values] of Object.entries(secrets)) {
    for (const [key, name] of Object.entries(values)) {
      if (typeof name !== 'string' || !SECRET_NAME_RE.test(name)) {
        throw new Error(`${CONFIG_PATH}: secrets.${group}.${key} must name a repository secret, e.g. "DEPLOY_KEY"`);
      }
    }
  }

  return { callers: [...new Set(callers)], inputs, secrets };
}

export function renderCaller(template, { sha, version, inputs = {}, secrets = {} }) {
  if (!SHA_RE.test(sha)) throw new Error(`invalid commit SHA: ${sha}`);
  if (!VERSION_RE.test(version)) throw new Error(`invalid version: ${version}`);

  const body = template
    .replace(/\r\n/g, '\n')
    .replace(BLOCK_RE, (_, indent, kind, group) =>
      kind === 'secrets' ? renderSecretsBlock(indent, group, secrets) : renderBlock(indent, kind, group, inputs),
    )
    .replaceAll('{{sha}}', sha)
    .replaceAll('{{version}}', version);

  if (/\{\{(sha|version|with:|inputs:|secrets:)/.test(body)) throw new Error('template has an unrendered placeholder');

  return `${HEADER}${body.trimEnd()}\n`;
}

// Map of repository path → file content for every caller in `config`.
export function renderAll(templates, config, pin) {
  const { callers, inputs, secrets } = validateConfig(config, templates);

  return new Map(callers.map((name) => [callerPath(name), renderCaller(templates[name], { ...pin, inputs, secrets })]));
}

export function renderConfig(config) {
  const { callers, inputs, secrets } = config;
  const ordered = Object.keys(CALLERS).filter((name) => callers.includes(name));
  // `secrets` only when set, so existing configs keep their canonical form.
  const extra = secrets && Object.keys(secrets).length > 0 ? { secrets } : {};

  return `${JSON.stringify({ callers: ordered, inputs, ...extra }, null, 2)}\n`;
}
