# Migrating a package repository

This is the checklist for moving a package repository from its own CI and
release workflows (often semantic-release, or a manual `v*` tag) to the
shared workflows. Do the steps in order; each one depends on the ones before
it.

The examples use `repo=mi-examples/<repo>`.

## 1. Check the organization prerequisites

The release flow and drift sync use the GitHub App and two org-level
settings. Check that the repository can see them:

```sh
gh api "repos/$repo/actions/organization-variables" --jq '.variables[].name'  # WORKFLOWS_BOT_APP_ID
gh api "repos/$repo/actions/organization-secrets" --jq '.secrets[].name'      # WORKFLOWS_BOT_APP_KEY, OPENAI_API_KEY
```

The GitHub App must also be installed on the repository. Without the App the
release pull request, the back-merge and drift sync can't open pull requests.
`GITHUB_TOKEN` can't create pull requests in this organization, and pull
requests it creates get no CI.

`OPENAI_API_KEY` is optional. Without it, the release notes fall back to
GitHub's generated notes.

## 2. Configure the repository

- **Auto-merge.** Allow auto-merge, so the back-merge pull request merges
  itself once its checks pass:

  ```sh
  gh api -X PATCH "repos/$repo" -F allow_auto_merge=true
  ```

- **Merge commits.** Keep merge commits allowed. The back-merge must be a merge
  commit so the release tag stays reachable from `develop`.
- **`npm-publish` environment.** Create it with its deployment branches, as in
  [npm-publishing.md, step 3](npm-publishing.md#3-create-the-npm-publish-environment).
  Use `main` and `develop`, or only `main` for a repository without `develop`.
  If it doesn't exist when the first publish job runs, GitHub creates it
  without any branch restriction.

## 3. Bring `develop` up to date

Skip this in a repository without `develop`.

If `main` has commits that `develop` lacks (for example a release merged or
tagged on `main`), open a pull request `main → develop` and merge it with a
**merge commit**:

```sh
git fetch origin
git log --oneline origin/develop..origin/main   # anything listed must reach develop first
gh pr create -R "$repo" -B develop -H main -t "chore: merge main into develop"
```

The release tools refuse to compute a beta from a `develop` that is behind
the last release. The main-ahead check would also fail the migration pull
request.

## 4. Open the migration pull request

Branch from `develop` (or `main` in a main-only repository).

1. **Write the settings.** Create `.github/mi-examples-workflows.json` with the
   inputs the old CI needed. See the input tables in [workflows.md](workflows.md).
   Common ones:

   | Old CI did | Input |
   | -- | -- |
   | checked that `dist/` exists after the build | `ci.dist-dir: "dist"` |
   | a custom audit script | `ci.audit-command` and `dependency-audit.audit-command` |
   | a Node version matrix | `ci.node-matrix: "[\"22\", \"24\"]"` (no EOL versions) |
   | fixture installs, `npx playwright install` | `ci.pre-test-commands` (one per line) |
   | e2e or other extra scripts | `ci.extra-scripts` (one per line) |
   | environment variables for the tests | `ci.env-vars` (`NAME=value`, one per line) |
   | freeing disk space | `ci.free-disk-space: true` |
   | a longer timeout | `ci.timeout-minutes` |
   | a build script other than `build` | `publish.build-script` |

2. **Run the installer** from the repository:

   ```sh
   npx github:mi-examples/mi-examples-workflows --release
   ```

   It overwrites `ci.yml` and `release.yml`, adds the other callers and
   rewrites the JSON in its canonical form. Move any job of the old `ci.yml`
   that isn't covered by the inputs into its own workflow file first.

3. **Remove the old release setup.** The installer lists what it finds, but
   doesn't delete anything:
   - `release-beta.yml` and any other old release workflows;
   - `.releaserc*`, `release.config.*`;
   - the semantic-release devDependencies (`npm uninstall semantic-release @semantic-release/...`);
   - the `release` script, and a `version` lifecycle script if one was only
     there for semantic-release.

4. **Check `package.json`.**
   - `repository.url` must match the GitHub repository exactly, or npm
     rejects the OIDC publish. `npm pkg fix` normalizes it.
   - Remove duplicate builds. CI and the publish jobs run the build before
     `npm test`, and `npm publish` runs `prepublishOnly`. A `test` script that
     starts with `npm run build &&`, or a `prepublishOnly` that only builds,
     makes every run build twice.

5. **Check what's newly enforced.** `node-ci.yml` runs `lint` and `typecheck`
   whenever those scripts exist. Run them locally first if the old CI didn't.

6. **Point Dependabot at `develop`.** Add `target-branch: 'develop'` to every
   update entry in `.github/dependabot.yml`.

7. **Rewrite the release docs.** Remove mentions of semantic-release,
   `NPM_TOKEN` and manual tagging from the README, `CONTRIBUTING.md` and
   similar files. Describe the new flow instead, or link to
   [workflows.md](workflows.md#release-workflows).

Don't write the CI-skip marker anywhere in a commit message or pull request
description, not even to say that it's gone. GitHub skips `push` and
`pull_request` runs when the marker appears anywhere in the head commit
message, and a squash merge copies the description into the commit.

## 5. After the migration pull request is merged

1. **Enable drift sync.** Set the org custom property:

   ```sh
   gh api -X PATCH "orgs/mi-examples/properties/values" --input - <<'EOF'
   { "repository_names": ["<repo>"], "properties": [{ "property_name": "workflows-consumer", "value": "true" }] }
   EOF
   ```

2. **Require the checks.** Add a repository ruleset for the default branch
   and `develop`:

   ```sh
   gh api -X POST "repos/$repo/rulesets" --input - <<'EOF'
   {
     "name": "Required checks",
     "target": "branch",
     "enforcement": "active",
     "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH", "refs/heads/develop"], "exclude": [] } },
     "rules": [{
       "type": "required_status_checks",
       "parameters": {
         "strict_required_status_checks_policy": false,
         "required_status_checks": [
           { "context": "CI / Node 24", "integration_id": 15368 },
           { "context": "CI / Audit / npm audit", "integration_id": 15368 },
           { "context": "Secret scan / gitleaks", "integration_id": 15368 }
         ]
       }
     }]
   }
   EOF
   ```

   - With `ci.node-matrix`, require one `CI / Node <version>` check per
     version.
   - In repositories with `develop`, add a second ruleset for
     `refs/heads/develop` only, requiring `Main ahead check / Check`.
   - Required checks also block direct pushes. That is expected: every change,
     including the back-merge, goes through a pull request.

3. **Release once.**
   - The next push to `develop` with a `feat`, `fix`, `perf` or `revert`
     commit publishes a beta.
   - Then run **Actions → Release → Run workflow**, review the release pull
     request, and merge it.

4. **Scope the trusted publisher to the environment.** Follow
   [Adding the environment to an existing package](npm-publishing.md#adding-the-environment-to-an-existing-package):
   revoke the configuration without an environment, then add the one with
   `--env npm-publish`.

5. **Lock down tokens.** Disallow token publishing on npmjs.com, and delete
   `NPM_TOKEN` and any other publish token from the repository secrets
   ([npm-publishing.md, step 5](npm-publishing.md#5-lock-down-tokens)).

## Repositories without `develop`

A main-only repository uses the same callers without betas:

- the installer skips `main-ahead-check.yml`;
- the release pull request is cut from `main`;
- there is no back-merge;
- `npm-publish` allows only `main`;
- the ruleset covers only the default branch.

## Repositories that publish with a token today

- **Package on npm.** The package must already exist on npm. If it doesn't,
  do the first publish by hand
  ([npm-publishing.md, step 2](npm-publishing.md#2-first-publish-of-a-new-package)).
- **Trusted publisher.** Add it with `--env npm-publish` directly: there is no
  configuration without an environment to replace.
- **Private repositories.** OIDC works, but npm generates no provenance.
  That's expected.
