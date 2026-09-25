# Workflows

Reusable workflows are called from a package repository's own workflow file
(the *caller*). Callers pin this repository by commit SHA with a version
comment; Dependabot keeps both up to date.

Every caller should set `permissions: {}` at workflow level and grant each job
only what the called workflow needs, as listed below.

## node-ci.yml

Pull-request CI for an npm package. It runs:

1. `npm ci`
2. lint, typecheck and build, each through `npm run --if-present`
3. optional pre-test commands
4. `npm test`, then optional extra scripts
5. a check that lists the files `npm pack` would publish

`npm audit` runs in a parallel job via `dependency-audit.yml`.

Caller job permissions: `contents: read`.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main, develop]

permissions: {}

jobs:
  ci:
    permissions:
      contents: read
    uses: mi-examples/mi-examples-workflows/.github/workflows/node-ci.yml@<sha> # vX.Y.Z
    with:
      dist-dir: dist
```

| Input | Default | Description |
| -- | -- | -- |
| `node-version` | `24` | Node.js version. Also used for the audit job. |
| `node-matrix` | `''` | JSON array of Node.js versions to test instead, e.g. `'["22", "24"]'`. |
| `working-directory` | `.` | Directory containing `package.json` and `package-lock.json`. |
| `lint` | `true` | Run `npm run lint` if the script exists. |
| `typecheck` | `true` | Run `npm run typecheck` if the script exists. |
| `build` | `true` | Run the build script if it exists. |
| `build-script` | `build` | Name of the build script, e.g. `build:component`. |
| `dist-dir` | `''` | Fail if this directory doesn't exist after the build. |
| `pre-test-commands` | `''` | Shell commands run after the build and before the tests. |
| `test` | `true` | Run `npm test` if the script exists. |
| `extra-scripts` | `''` | More npm scripts to run after the tests, one per line. |
| `env-vars` | `''` | Extra environment variables, one `NAME=value` per line. |
| `free-disk-space` | `false` | Remove large preinstalled toolchains from the runner first. |
| `pack-check` | `true` | List the files `npm pack` would publish. |
| `audit` | `true` | Run the dependency audit job. |
| `audit-command` | `npm audit --audit-level=high` | Command that performs the audit. |
| `timeout-minutes` | `20` | Timeout of the CI job. |

Example with the extra inputs a larger package needs:

```yaml
    with:
      dist-dir: dist
      free-disk-space: true
      timeout-minutes: 30
      audit-command: npm run audit:all
      pre-test-commands: |
        npm install --prefix tests/test-nextjs --no-audit --package-lock=false
      extra-scripts: |
        test:e2e
        test:e2e:browser
      env-vars: |
        PLAYWRIGHT_USE_SYSTEM_CHROME=1
```

## secret-scan.yml

Scans git history for secrets with [gitleaks](https://github.com/gitleaks/gitleaks).
Findings are redacted in the log.

| Event | What is scanned |
| -- | -- |
| `pull_request` | The pull request's commits. |
| `push` | The pushed commits. |
| Anything else (`schedule`, `workflow_dispatch`) | The whole history. |

It runs the gitleaks release binary, verified against a hardcoded SHA-256,
because `gitleaks-action` needs a license key for organizations. A
`.gitleaks.toml` in the repository root is picked up automatically, for
example to allowlist test fixtures.

Caller job permissions: `contents: read`.

```yaml
# .github/workflows/secret-scan.yml
name: Secret scan

on:
  pull_request:

permissions: {}

jobs:
  secret-scan:
    permissions:
      contents: read
    uses: mi-examples/mi-examples-workflows/.github/workflows/secret-scan.yml@<sha> # vX.Y.Z
```

| Input | Default | Description |
| -- | -- | -- |
| `full-history` | `false` | Scan the whole history even on `pull_request` and `push`. |

Also enable GitHub secret scanning with push protection in the repository
settings. It is free for public repositories.

## dependency-audit.yml

Runs `npm audit` against the lockfile. `node-ci.yml` calls it on every pull
request. Package repositories also call it on a weekly schedule, to catch
advisories published after a dependency was installed.

Caller job permissions: `contents: read`.

```yaml
# .github/workflows/dependency-audit.yml
name: Dependency audit

on:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

permissions: {}

jobs:
  audit:
    permissions:
      contents: read
    uses: mi-examples/mi-examples-workflows/.github/workflows/dependency-audit.yml@<sha> # vX.Y.Z
```

| Input | Default | Description |
| -- | -- | -- |
| `node-version` | `24` | Node.js version used to run the audit. |
| `audit-command` | `npm audit --audit-level=high` | Command that performs the audit. |
| `install` | `false` | Run `npm ci --ignore-scripts` first. Only needed when `audit-command` runs project code. |
| `working-directory` | `.` | Directory containing `package.json` and `package-lock.json`. |

## Release workflows

The release flow uses five reusable workflows, all called from **one caller
file per package repository, `.github/workflows/release.yml`**. npm matches
the trusted publisher on that filename, so don't rename it. See
[npm-publishing.md](npm-publishing.md) for the one-time npm and GitHub setup.

| Trigger in the package repository | Reusable workflow | What happens |
| -- | -- | -- |
| push to `develop` | `release-beta.yml` | publishes `X.Y.Z-beta.N` under the `beta` dist-tag, then tags it and creates a GitHub prerelease |
| manual run (`workflow_dispatch`) | `prepare-release.yml` | opens the release pull request `release/vX.Y.Z → main` with the version bump and the CHANGELOG entry |
| push to `main` (merging the release pull request) | `release.yml` | publishes `X.Y.Z` under `latest`, then tags it and creates the GitHub release from the CHANGELOG entry |
| after a release | `back-merge.yml` | opens a pull request `main → develop` with auto-merge on |
| pull requests into `develop` | `main-ahead-check.yml` | fails when `main` has commits that `develop` lacks |

A repository without `develop` (main-only) works the same way. The release
pull request is cut from `main`, and there are no betas and no back-merge.

Nothing is ever committed back by CI and no commit uses `[skip ci]`, so every
pull request, including the release pull request, gets full CI. Publish jobs
run in the `npm-publish` environment, and they are the only jobs with
`id-token: write`.

### Caller: release.yml

```yaml
# .github/workflows/release.yml. The npm trusted publisher is registered
# for this filename, so don't rename it.
name: Release

on:
  push:
    branches: [main, develop]
  workflow_dispatch:

permissions: {}

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  prepare:
    name: Prepare release
    if: github.event_name == 'workflow_dispatch'
    permissions:
      contents: read
    uses: mi-examples/mi-examples-workflows/.github/workflows/prepare-release.yml@<sha> # vX.Y.Z
    with:
      app-id: ${{ vars.WORKFLOWS_BOT_APP_ID }}
    secrets:
      app-key: ${{ secrets.WORKFLOWS_BOT_APP_KEY }}
      openai-api-key: ${{ secrets.OPENAI_API_KEY }}

  beta:
    name: Beta
    if: github.event_name == 'push' && github.ref == 'refs/heads/develop'
    permissions:
      contents: write
      id-token: write
    uses: mi-examples/mi-examples-workflows/.github/workflows/release-beta.yml@<sha> # vX.Y.Z

  release:
    name: Release
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      contents: write
      id-token: write
    uses: mi-examples/mi-examples-workflows/.github/workflows/release.yml@<sha> # vX.Y.Z

  back-merge:
    name: Back-merge
    needs: release
    if: needs.release.outputs.released == 'true'
    permissions:
      contents: read
    uses: mi-examples/mi-examples-workflows/.github/workflows/back-merge.yml@<sha> # vX.Y.Z
    with:
      app-id: ${{ vars.WORKFLOWS_BOT_APP_ID }}
      version: ${{ needs.release.outputs.version }}
    secrets:
      app-key: ${{ secrets.WORKFLOWS_BOT_APP_KEY }}
```

In repositories with a `develop` branch, add the main-ahead check to the CI
caller:

```yaml
# .github/workflows/ci.yml, next to the ci job
  main-ahead:
    name: Main ahead check
    if: github.base_ref == 'develop'
    permissions:
      contents: read
    uses: mi-examples/mi-examples-workflows/.github/workflows/main-ahead-check.yml@<sha> # vX.Y.Z
```

### release-beta.yml and release.yml

The two publishing workflows have the same inputs:

| Input | Default | Description |
| -- | -- | -- |
| `node-version` | `24` | Node.js version used to build and publish. |
| `build-script` | `build` | Build script, run with `npm run --if-present`. |
| `test` | `true` | Run `npm test` before publishing, if the script exists. |
| `environment` | `npm-publish` | GitHub environment of the publish job. The npm trusted publisher should name it. |
| `access` | `public` | npm access level. |

`release.yml` has two outputs, `released` (`"true"` when a new release was
created) and `version`.

- **When `release.yml` publishes.** It publishes only when the `package.json`
  version on `main` has no `vX.Y.Z` tag yet and is newer than the last
  release. Every other push to `main` does nothing. A version that isn't newer
  and has no tag fails the run, so a mistake in the release pull request is
  caught.
- **When `release-beta.yml` publishes.** It publishes nothing when there are
  no `feat`, `fix`, `perf`, `revert` or breaking commits since the last
  release. It fails when a newer release on `main` hasn't been merged back
  into `develop` yet.
- **Re-running.** Both workflows are safe to re-run: a version that is
  already on npm, or a release that already exists, is skipped.

### prepare-release.yml

Run it from the **Actions** tab (**Release → Run workflow**). It works like
this:

1. It computes the next version from the conventional commits since the last
   release.
2. It bumps `package.json` and `package-lock.json`.
3. It writes the CHANGELOG entry. The notes come from AI when
   `OPENAI_API_KEY` is set, otherwise from GitHub, otherwise from the
   conventional commits.
4. It opens the release pull request with the GitHub App token, so CI runs on
   it.

The pull request lists which notes source was used, with any warnings. Review
and edit the CHANGELOG entry before merging.

| Input | Default | Description |
| -- | -- | -- |
| `app-id` | required | ID of the GitHub App (`vars.WORKFLOWS_BOT_APP_ID`). |
| `base` | `''` | Branch to cut the release from. Empty means `develop` if it exists, otherwise `main`. |
| `node-version` | `24` | Node.js version for the release tools. |
| `model` | `gpt-5-mini` | OpenAI model for the release notes. |

Secrets: `app-key` (required) and `openai-api-key` (optional).

### back-merge.yml

It opens a pull request from `main` into `develop` using the App token, so
`develop`'s required checks run. It then turns on auto-merge with a merge
commit, when the repository allows auto-merge. Merge conflicts stay in the
pull request for a person to resolve. The workflow does nothing without a
`develop` branch, or when `develop` already contains `main`.

| Input | Default | Description |
| -- | -- | -- |
| `app-id` | required | ID of the GitHub App. |
| `base` | `develop` | Branch to merge into. |
| `head` | `main` | Released branch. |
| `version` | `''` | Released version, used in the pull request title. |

Secret: `app-key` (required).

### main-ahead-check.yml

| Input | Default | Description |
| -- | -- | -- |
| `mode` | `fail` | `fail` blocks the pull request, `warn` only annotates it. |
| `main-branch` | `main` | The production branch. |

The back-merge pull request itself (head `main`) always passes.
