# Publishing to npm

Packages publish from GitHub Actions with
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). No
npm token is stored anywhere.

npm checks the calling workflow, not the reusable one. In every package
repository, the caller must therefore be `.github/workflows/release.yml`, and
the publish job must run in the GitHub environment `npm-publish`.

Setting up a package takes these steps, once per package:

| Step | Where | Needed for |
| -- | -- | -- |
| [1. Check package.json](#1-check-packagejson) | package repository | every package |
| [2. First publish](#2-first-publish-of-a-new-package) | your machine | new packages only |
| [3. Create the `npm-publish` environment](#3-create-the-npm-publish-environment) | GitHub | every package |
| [4. Configure the trusted publisher](#4-configure-the-trusted-publisher) | npmjs.com | every package |
| [5. Lock down tokens](#5-lock-down-tokens) | npmjs.com, GitHub | every package |

## 1. Check package.json

- **`repository.url`** must match the GitHub repository exactly, including
  case: `git+https://github.com/mi-examples/<repo>.git`. npm refuses an OIDC
  publish when it doesn't match.
- **`npm pkg fix`** should report nothing. Otherwise npm auto-corrects the
  manifest on every publish and prints `npm warn publish ... auto-corrected`.
  For example, a `bin` path written as `./dist/cli.js` becomes `dist/cli.js`,
  and a `repository.url` without `git+` gets normalized.
- **Scoped public packages** need `"publishConfig": { "access": "public" }`,
  or `--access public` on the first publish.
- **`npm pack --dry-run`** lists exactly the files that will be published.
  Check it for build output, and for files that don't belong in the package.

## 2. First publish of a new package

A trusted publisher can only be configured for a package that already exists
on npm. The very first version of a new package is therefore published once by
hand. Every later version comes from CI.

1. **Log in.** Log in with your company npm account, which must have publish
   rights in the `@metricinsights` scope. The account needs two-factor
   authentication.

   ```sh
   npm login
   npm whoami
   ```

2. **Build a clean checkout** of the commit you are releasing:

   ```sh
   git status          # must be clean
   npm ci
   npm run build
   npm pack --dry-run  # review the file list
   ```

3. **Publish.** Set the version in `package.json` (for example `0.1.0`), then
   publish. npm asks for a 2FA code.

   ```sh
   npm publish --access public
   ```

   A manual publish has no provenance. That is expected; the releases from CI
   will have it.

4. **Tag the commit.** The release tools compute every later version from
   the last production tag, so tag the published commit:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

   Do the same for a package that was published by hand before and has no
   tags yet.

5. **Add more owners.** Make sure the package has more than one owner:

   ```sh
   npm owner ls @metricinsights/<package>
   npm owner add <npm-user> @metricinsights/<package>
   ```

## 3. Create the `npm-publish` environment

A trusted publisher without an environment accepts a publish from **any
branch** of the repository. Anyone with write access could publish a release
by pushing a branch with an edited `release.yml`. The `npm-publish`
environment closes that gap: only the listed branches can deploy to it, and
the trusted publisher only accepts tokens from jobs that run in it.

In the repository go to **Settings → Environments → New environment**:

1. Name the environment `npm-publish`.
2. Under **Deployment branches and tags**, choose **Selected branches and
   tags** and add:
   - `main` and `develop` for repositories with a `develop` branch;
   - only `main` for main-only repositories.
3. Optionally, add **Required reviewers** if every publish should wait for a
   manual approval.

The same setup with the GitHub CLI:

```sh
repo=mi-examples/<repo>

gh api -X PUT "repos/$repo/environments/npm-publish" --input - <<'EOF'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
EOF

for branch in main develop; do
  gh api -X POST "repos/$repo/environments/npm-publish/deployment-branch-policies" -f name="$branch" -f type=branch
done
```

## 4. Configure the trusted publisher

On npmjs.com open the package, then go to **Settings → Trusted publishing →
GitHub Actions**, and fill in:

| Field | Value |
| -- | -- |
| Organization or user | `mi-examples` |
| Repository | the repository name, e.g. `qa-ai-rules` |
| Workflow filename | `release.yml` |
| Environment name | `npm-publish` |
| Allowed actions | tick **npm publish** |

Configurations created since 2026-09-03 allow only `npm stage publish` by
default. Without **npm publish** ticked, the release workflow fails.

The same with the npm CLI (npm 11.15 or newer, logged in with 2FA):

```sh
npm trust github @metricinsights/<package> --file release.yml --repo mi-examples/<repo> --env npm-publish --allow-publish
npm trust list @metricinsights/<package>
```

### Adding the environment to an existing package

The packages that already publish with OIDC have a trusted publisher without
an environment. A package can have up to 10 configurations, so you can switch
it without a failed release:

1. Create the `npm-publish` environment (step 3).
2. Move the repository to the shared release workflow, which runs its publish
   job in `npm-publish`.
3. Add a second trusted publisher **with** the environment, as described above.
4. Release once and check the result.
5. Revoke the old configuration without the environment. Until you do,
   publishing from any branch is still possible.

   ```sh
   npm trust list @metricinsights/<package>
   npm trust revoke @metricinsights/<package> --id=<id of the configuration without an environment>
   ```

### Renaming the caller workflow

npm matches the workflow filename. Before you rename `release.yml`, add a
trusted publisher for the new name. Revoke the old one after the first
successful release. The shared workflows assume `release.yml`, so only do
this for a good reason.

## 5. Lock down tokens

Once a release from CI has worked:

- **Disallow tokens on npmjs.com.** Go to the package's **Settings →
  Publishing access** and choose **Require two-factor authentication and
  disallow tokens**. Trusted publishing keeps working.
- **Delete token secrets.** Delete any `NPM_TOKEN` (or similar) secret from
  the repository.

## Private repositories

Publishing from a private repository works with OIDC, but npm generates **no
provenance** for it. This is an npm limitation, not a misconfiguration.

## Troubleshooting

| Symptom | Likely cause |
| -- | -- |
| CI publish fails with `E404 Not Found - PUT https://registry.npmjs.org/...` | The trusted publisher doesn't match: repository, workflow filename or environment differ; `id-token: write` is missing in the caller job; or **npm publish** isn't allowed. |
| CI publish fails with `ENEEDAUTH` or `E401` | A token in `NODE_AUTH_TOKEN` or `.npmrc` interferes with OIDC, or npm is older than 11.5.1. |
| A publish from a feature branch succeeds | The trusted publisher has no environment. See step 3 and [Adding the environment](#adding-the-environment-to-an-existing-package). |
| A local `npm unpublish`, `npm deprecate` or `npm trust` returns `404` on `PUT` | You are logged in with an account that doesn't own the package. Check `npm whoami` and `npm owner ls @metricinsights/<package>`. |
| `npm view` doesn't show a version that was just published | The registry takes from about 20 seconds up to a few minutes. Unpublishing is also slow to show. |
| `npm warn publish ... auto-corrected some errors in your package.json` | Run `npm pkg fix` and commit the result. |

To take back a version published by mistake, run
`npm unpublish @metricinsights/<package>@<version>` within 72 hours. The version
number can never be used again. After 72 hours, use `npm deprecate` instead.
