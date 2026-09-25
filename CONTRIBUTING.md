# Contributing

Changes here run in every consuming package repository, so the bar is higher
than for a normal repository.

## Workflow conventions

Every workflow and composite action must follow these rules. CI and code
review check them.

- **Pinned references.** Pin third-party actions and reusable workflows by full
  commit SHA with a version comment:
  `uses: actions/checkout@<sha> # v7.0.1`. `node scripts/check-pinned-actions.mjs`
  enforces this.
- **Permissions.** Set `permissions: {}` at workflow level and grant each job
  only what it needs.
  - `id-token: write` belongs only on npm publish jobs.
  - `contents: write` belongs only on jobs that push.
- **Checkout credentials.** Use `persist-credentials: false` on every checkout,
  except in jobs that must push.
- **Timeouts.** Give every job a `timeout-minutes`.
- **Concurrency.** Give release jobs a `concurrency` group.
- **Untrusted input.** Never interpolate untrusted values with `${{ }}` inside
  `run:`. Pass them through `env:` and quote them in the script. This covers
  branch names, PR titles, commit messages and `workflow_dispatch` inputs.
- **Downloaded tools.** Verify every tool downloaded at run time against a
  SHA-256 hardcoded in the workflow.
- **Node.** Default to Node 24. Never add EOL Node versions to defaults.
- **npm.** Use `npm ci`, never `npm install`. Never `npm install -g npm@latest`.
- **Publish jobs.** No `NODE_AUTH_TOKEN` or `.npmrc` token in a publish job;
  publishing uses Trusted Publishing (OIDC).
- **Workflow inputs.** Keep inputs minimal. Each new input needs a default that
  matches the common case, and a README entry.

Don't merge a change that weakens these defaults without an explicit note in
the pull request description.

## Scripts

Scripts are plain Node.js with no dependencies. Use only `node:` built-ins.
Run external commands with `execFileSync` and an argument array, never
through a shell. Tests use `node:test`:

```sh
npm test               # unit tests
npm run check:pins     # SHA-pinning check
```

## Caller templates

`templates/*.yml` are the callers that package repositories get. The
installer and drift sync render them through `scripts/callers/render.mjs`.
CI lints the rendered output with actionlint and zizmor.

A template change reaches every package repository as a drift-sync pull
request after the next release tag. Keep templates backwards compatible with
existing `.github/mi-examples-workflows.json` files, or document the
migration.

## Validating changes

Validate workflow changes on a pilot package repository before tagging a
release. Point its caller at the branch commit SHA.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). The release
tooling derives versions from them.
