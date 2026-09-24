# mi-examples-workflows

Shared GitHub Actions workflows for the npm packages published from the
[`mi-examples`](https://github.com/mi-examples) organization.

A CI or release fix is made once here and reaches every package through
reusable workflows (`on: workflow_call`) and an `npx` installer that keeps the
caller files in each package repository up to date.

> **Status:** under construction. The workflows below are planned and not
> ready for use yet. Don't reference this repository from other repositories
> until the first `v1.0.0` release.

## Planned workflows

| Workflow | Purpose |
| -- | -- |
| `node-ci.yml` | `npm ci`, then lint, typecheck, build, test and `npm audit` on pull requests. |
| `secret-scan.yml` | gitleaks on pull requests. |
| `dependency-audit.yml` | Weekly `npm audit` on the default branch. |
| `release-beta.yml` | Publishes `X.Y.Z-beta.N` to npm under the `beta` dist-tag on every push to `develop`. |
| `prepare-release.yml` | Opens a release pull request into `main` with the version bump and a reviewed changelog entry. |
| `release.yml` | Publishes the merged release to npm with Trusted Publishing (OIDC), then tags it and creates a GitHub release. |
| `back-merge.yml` | Merges `main` back into `develop` after each release. |

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
