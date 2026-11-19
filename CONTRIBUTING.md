# Contributing

A pull request is accepted when every check below passes. Two workflows run on each pull request and on pushes to `main`.

## Checks

### Type check, lint and tests (`.github/workflows/ci.yml`)

The job installs dependencies with `pnpm install --frozen-lockfile` on Node 24 and runs, in order:

| Step | Command | What it verifies |
| --- | --- | --- |
| Type check | `pnpm ts` | TypeScript compiles in every package, with no emit |
| Lint | `pnpm lint` | ESLint, which also owns code formatting |
| Unit tests | `pnpm test` | Rstest specs (`*.spec.ts`) of every package |
| End-to-end tests | `pnpm test:e2e` | The server's e2e suite |

Run the same commands from the repository root before pushing. `pnpm format` fixes the formatting problems that ESLint can fix, and `pnpm test:cov` reports coverage; the target is 100% of the executable production lines.

If `pnpm-lock.yaml` is out of date, `pnpm install --frozen-lockfile` fails: commit the lockfile together with the `package.json` change.

### Commit authors (`.github/workflows/commit-authors.yml`)

Shared from `douglasjunior/workflows`. Every commit of the pull request must be authored and committed by a person:

- No AI agent as author, committer or co-author (`Co-Authored-By` trailers included).
- On the owner's own pull requests, only the owner's identities may appear as author and committer.

A commit that breaks the rule has to be recreated with the right identity (`git commit --amend --reset-author`, then a force push of the pull request branch).

## Conventions reviewed with the pull request

- **Commit messages**: Conventional Commits in English, imperative mood, subject of up to 50 characters with no trailing period.
- **Language**: source code, tests, comments and documentation are in English.
- **No agent attribution**: commits, pull request descriptions, comments and documentation carry no "Generated with" line or similar signature.
- **Skills in sync**: a change to a port contract, public signature, lifecycle or rule updates the matching `SKILL.md` in `.agents/skills/` in the same commit.
- **Rules of the codebase**: `AGENTS.md` lists the architecture, testing and comment rules that apply to every change.
