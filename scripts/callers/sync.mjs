// Drift sync for one package repository: renders the callers for the pinned
// release with the repository's own settings (CONFIG_PATH) and, when a file
// differs, commits the rendered files on top of the base branch and opens or
// updates one pull request. It never pushes to the base branch.
//
// Everything goes through the GitHub REST API with the GitHub App token, so
// the commit is created and signed by the App.

import { CONFIG_PATH, renderAll } from './render.mjs';

export const SYNC_BRANCH = 'mi-examples-workflows/sync';

export function createClient({ token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  return async function request(method, path, body, { allow404 = false } = {}) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    if (allow404 && response.status === 404) return null;

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);

      throw new Error(`${method} ${path} failed: ${response.status} ${detail}`.trim());
    }

    return response.status === 204 ? null : response.json();
  };
}

async function readFile(request, repo, path, ref) {
  const file = await request('GET', `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, null, { allow404: true });

  if (!file) return null;

  return Buffer.from(file.content, 'base64').toString('utf8').replace(/\r\n/g, '\n');
}

function pullRequestBody({ version, files }) {
  return [
    `Updates the shared-workflow callers to **mi-examples-workflows ${version}**.`,
    '',
    'Changed files:',
    ...files.map((path) => `- \`${path}\``),
    '',
    `These files are generated from the templates of that release and the settings in \`${CONFIG_PATH}\`. To change a setting, edit that file and run \`npx github:mi-examples/mi-examples-workflows\`; don't edit the callers by hand, the next sync would undo it.`,
    '',
    'Opened by drift sync. It updates this pull request until it is merged.',
  ].join('\n');
}

export async function syncRepository({ request, repo, templates, pin, dryRun = false, log = () => {} }) {
  // owner/name, where neither part is only dots (no path traversal).
  if (!/^(?!\.+\/)[A-Za-z0-9_.-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/.test(repo)) throw new Error(`invalid repository: ${repo}`);

  const { default_branch: defaultBranch } = await request('GET', `/repos/${repo}`);
  const develop = await request('GET', `/repos/${repo}/branches/develop`, null, { allow404: true });
  const base = develop ? 'develop' : defaultBranch;
  const rawConfig = await readFile(request, repo, CONFIG_PATH, base);

  if (rawConfig === null) {
    log(`${repo}: no ${CONFIG_PATH} on ${base}; run the installer there first.`);

    return { status: 'not-installed', base, files: [] };
  }

  const rendered = renderAll(templates, JSON.parse(rawConfig), pin);
  const drifted = [];

  for (const [path, content] of rendered) {
    if ((await readFile(request, repo, path, base)) !== content) drifted.push(path);
  }

  if (drifted.length === 0) {
    log(`${repo}: in sync with ${pin.version}.`);

    return { status: 'in-sync', base, files: [] };
  }

  log(`${repo}: ${drifted.length} file(s) differ from ${pin.version} on ${base}: ${drifted.join(', ')}`);

  if (dryRun) return { status: 'drift', base, files: drifted };

  const baseRef = await request('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const baseCommit = await request('GET', `/repos/${repo}/git/commits/${baseRef.object.sha}`);
  const tree = await request('POST', `/repos/${repo}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: drifted.map((path) => ({ path, mode: '100644', type: 'blob', content: rendered.get(path) })),
  });
  const commit = await request('POST', `/repos/${repo}/git/commits`, {
    message: `ci: sync the shared workflow callers to mi-examples-workflows ${pin.version}`,
    tree: tree.sha,
    parents: [baseRef.object.sha],
  });

  // The sync branch is rebuilt on top of the current base every time, so it
  // never goes stale or picks up conflicts.
  const existing = await request('GET', `/repos/${repo}/git/ref/heads/${SYNC_BRANCH}`, null, { allow404: true });

  if (existing) {
    await request('PATCH', `/repos/${repo}/git/refs/heads/${SYNC_BRANCH}`, { sha: commit.sha, force: true });
  } else {
    await request('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${SYNC_BRANCH}`, sha: commit.sha });
  }

  const owner = repo.split('/')[0];
  const [open] = await request('GET', `/repos/${repo}/pulls?state=open&head=${owner}:${SYNC_BRANCH}&base=${encodeURIComponent(base)}`);
  const title = `ci: sync the shared workflow callers to mi-examples-workflows ${pin.version}`;
  const body = pullRequestBody({ version: pin.version, files: drifted });
  const pr = open
    ? await request('PATCH', `/repos/${repo}/pulls/${open.number}`, { title, body })
    : await request('POST', `/repos/${repo}/pulls`, { title, body, head: SYNC_BRANCH, base });

  log(`${repo}: ${open ? 'updated' : 'opened'} ${pr.html_url}`);

  return { status: 'updated', base, files: drifted, pr: pr.html_url };
}
