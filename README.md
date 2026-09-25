# mi-examples-workflows

Shared GitHub Actions workflows for the npm packages published from the
[`mi-examples`](https://github.com/mi-examples) organization.

A CI or release fix is made once here and reaches every package through
reusable workflows (`on: workflow_call`) and an `npx` installer that keeps the
caller files in each package repository up to date.

> **Status:** under construction. Until `v1.0.0`, only pilot package
> repositories use these workflows, and inputs may still change.

## Workflows

See [docs/workflows.md](docs/workflows.md) for caller examples and all inputs.

| Workflow | Purpose | Status |
| -- | -- | -- |
| `node-ci.yml` | `npm ci`, then lint, typecheck, build, test and `npm audit` on pull requests. | available |
| `secret-scan.yml` | gitleaks on pull requests. | available |
| `dependency-audit.yml` | Weekly `npm audit` on the default branch. | available |
| `release-beta.yml` | Publishes `X.Y.Z-beta.N` to npm under the `beta` dist-tag on every push to `develop`. | piloting |
| `prepare-release.yml` | Opens a release pull request into `main` with the version bump and a reviewed changelog entry. | piloting |
| `release.yml` | Publishes the merged release to npm with Trusted Publishing (OIDC), then tags it and creates a GitHub release. | piloting |
| `back-merge.yml` | Opens the `main → develop` back-merge pull request after each release. | piloting |
| `main-ahead-check.yml` | Fails pull requests into `develop` while `main` has commits that `develop` lacks. | piloting |

Before a package can publish, it needs a one-time npm and GitHub setup:
the first publish of a new package, the `npm-publish` environment and the
trusted publisher. See [docs/npm-publishing.md](docs/npm-publishing.md).

Versions, release notes and changelog entries are computed by the
zero-dependency [release tools](docs/release-tools.md) from Conventional
Commits.

## Security defaults

Every workflow in this repository follows these rules:

- **Pinned references.** Third-party actions and reusable workflows are pinned
  by full commit SHA with a version comment. CI enforces this with
  `scripts/check-pinned-actions.mjs`.
- **Least privilege.** Workflow-level `permissions: {}`; each job is granted
  only what it needs.
- **No persisted credentials.** `persist-credentials: false` on every
  checkout, except in jobs that must push.
- **Tokenless publishing.** npm publishing uses Trusted Publishing (OIDC) only.
  No long-lived npm token is read anywhere.
- **Reproducible installs.** `npm ci`, never `npm install`.
- **Verified tools.** Tools downloaded at run time are checksum-verified
  against a SHA-256 hardcoded in the workflow.

## Versioning

- **Tags.** This repository is released with semver tags `vX.Y.Z`.
- **Caller pins.** Callers reference it by commit SHA plus a version comment:

  ```yaml
  uses: mi-examples/mi-examples-workflows/.github/workflows/node-ci.yml@<sha> # vX.Y.Z
  ```

- **Updates.** Dependabot (`github-actions` ecosystem) updates both the SHA and
  the comment in the caller files.
- **Breaking changes.** A breaking change to workflow inputs bumps the major
  version and comes with a migration note.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
