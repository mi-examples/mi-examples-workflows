# Release tools

`scripts/release/cli.mjs` computes versions, release notes and changelog
entries for the release workflows. It is plain Node.js with no dependencies and
calls `git` through argument arrays, never through a shell.

The tools need the full history and all tags. Check out with
`fetch-depth: 0`.

## Commands

| Command | What it does | `$GITHUB_OUTPUT` keys |
| -- | -- | -- |
| `next-version [--ref HEAD]` | Prints the next production version, or nothing when there is nothing to release. | `release`, `version`, `level`, `last-tag` |
| `next-beta [--ref HEAD]` | Prints the next `X.Y.Z-beta.N`. | `release`, `version`, `base-version`, `level`, `last-tag`, `previous-tag`, `already-tagged` |
| `release-status [--ref HEAD]` | Prints the state of the `package.json` version: `new` (no tag yet, newer than the last release), `released`, `prerelease`, or `stale` (no tag, not newer; exits 1). | `state`, `version`, `tag`, `tag-exists`, `last-tag` |
| `notes --version <v> [--from <tag>] [--to HEAD]` | Conventional-commit notes for the range, grouped by type. `--from` defaults to the last production tag. | — |
| `release-notes --version <v> [--from <tag>] [--sources ai,github,conventional]` | The full CHANGELOG section for a production release. See [Release notes](#release-notes). | `source`, `warnings` |
| `changelog-insert --version <v> --notes-file <file>` | Inserts the section at the top of `CHANGELOG.md`, or replaces the existing section for the same version. | — |
| `changelog-extract --version <v> [--with-heading]` | Prints one version's section, e.g. for the GitHub release body. | — |

Run `node scripts/release/cli.mjs --help` for all options.

## How versions are computed

1. **Base version.** The base is the highest production tag `vX.Y.Z` reachable
   from `--ref`. Prerelease tags are ignored.
2. **Release level.** The level comes from the non-merge commits since that
   tag:

   | Commit | Release |
   | -- | -- |
   | `feat:` | minor |
   | `fix:`, `perf:`, `revert:`, a git `Revert "..."` | patch |
   | a `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer on any type, or `type!:` | major |
   | `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore`, anything else | no release |

   These are the rules of the angular preset the packages used with
   semantic-release. The one addition is `type!:`, which the angular parser
   ignored.
3. **0.x versions.** A breaking change on `0.x` releases `1.0.0`.
4. **Betas.** A beta is the next production version plus `-beta.N`.
   - `N` is one more than the highest existing `vX.Y.Z-beta.*` tag, on any
     branch.
   - If `--ref` already carries a beta tag for that version, that beta is
     returned with `already-tagged=true`, so a failed publish can be retried.

## Safety checks

- **No production tag.** The tools fail when no production tag is reachable.
  To bootstrap a package, tag the commit of its last published version first.
- **Stale baseline.** The tools fail when a newer production tag exists but is
  not reachable from `--ref`. This usually means `main` was released and not
  merged back into `develop`. Computing from the old tag would produce a
  version that is already behind.

## Release notes

`release-notes` writes the CHANGELOG section for a production release. The
release workflow puts that section into the release pull request, where people
review and edit it before anything is published.

It tries each source in `--sources` order and uses the first one that works:

| Source | Needs | What it produces |
| -- | -- | -- |
| `ai` | `OPENAI_API_KEY` | Notes written by an OpenAI model (default `gpt-5-mini`, set with `--model`) from the commits and the diff since the previous release. |
| `github` | `GITHUB_TOKEN`, `GITHUB_REPOSITORY` | GitHub's generated "What's Changed" list of merged pull requests. |
| `conventional` | nothing | Conventional-commit notes grouped by type. This source always works. |

Every skipped or failed source adds a line to the `warnings` output. The
workflow shows these lines in the pull request, so reviewers know which source
they are looking at.

### How the AI notes are protected

Commit messages and diffs are untrusted input, because anyone who can land a
commit controls them. The tools protect against that in these ways:

- **Delimited data.** The commits and the diff go to the model inside a block
  marked by a random boundary. The rules tell the model to treat that block
  as data and never follow instructions in it. The model has no tools.
- **Less data sent.** Only the commits and diff of the release range are sent.
  Lockfiles, build output, source maps and key or `.env` files are excluded.
  Common credential formats are redacted, and the diff and every commit body
  are capped in size.
- **Rebuilt output.** The model's answer is rebuilt from the allowed headings
  (`⚠ Breaking changes`, `Features`, `Bug fixes`, `Other changes`) and
  bullets only:
  - links, URLs and images are removed, and raw HTML is escaped;
  - `@mentions` are wrapped in code spans, so nobody is pinged;
  - bullet length and count are capped.
- **Fallbacks.** A draft is reviewed by a second call against the same rules.
  If the review fails, the draft is used. If nothing usable is left, the next
  source is used instead.
- **Redacted warnings.** Warnings are redacted before they are written,
  because API errors can echo fragments of credentials.
