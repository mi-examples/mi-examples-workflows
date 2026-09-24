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
