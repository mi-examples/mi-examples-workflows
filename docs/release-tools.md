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
| `notes --version <v> [--from <tag>] [--to HEAD]` | Conventional-commit notes for the range, grouped by type. `--from` defaults to the last production tag. | — |
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
