import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const RUNNING_CHECKS_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.runningChecks,
  description: 'Running a project\'s checks (tests, lint, format, type check, build) for one file or one package - finding them in CI workflows and manifests, finding the package of a file in a monorepo, and the commands of Node, workspace orchestrators, Python, Go, Rust, JVM and .NET projects. Read it when you do not know how to run a check for one file or one package in this ecosystem.',
  roles: ['DEVELOPER', 'CODE_REVIEWER', 'QA'],
  buildContent: () => `# Running Checks

Run every check non-interactively (\`CI=1\`, no watch mode) and prefer the project's own script over the bare tool, so its configuration and flags apply. Pass a file through the script when it forwards arguments: \`pnpm test src/a.spec.ts\`, \`yarn test src/a.spec.ts\`, \`npm test -- src/a.spec.ts\`.

## Find the Checks
- Read, in this order: \`AGENTS.md\` and \`CONTRIBUTING.md\`, the CI configuration, the manifest scripts (\`package.json\`, \`pyproject.toml\`, \`Makefile\`, \`justfile\`, \`Taskfile.yml\`) and the pre-commit hooks (\`.husky/\`, \`lint-staged\`, \`.pre-commit-config.yaml\`).
- A CI workflow lists what a pull request must pass. In \`.github/workflows/*.yml\`, take the jobs that run on \`pull_request\` and the \`run:\` lines of their steps, with the \`working-directory\`, the \`env\` and the \`matrix\` they use; a \`paths\` filter says which changes trigger the job. The same holds for the \`script:\` of \`.gitlab-ci.yml\`, \`azure-pipelines.yml\`, \`.circleci/config.yml\` and a \`Jenkinsfile\`. Steps that deploy, publish or need secrets are not checks to run locally; a \`services:\` block names what a check needs running (a database), which you start the way the project documents or report as missing.

## Find the Package of a File
- Walk up from the file to the nearest manifest: \`package.json\`, \`pyproject.toml\`, \`go.mod\`, \`Cargo.toml\`, \`build.gradle(.kts)\`, \`pom.xml\`, \`*.csproj\`. Its folder is the package and its \`name\` is what filters take.
- A monorepo declares its packages in \`pnpm-workspace.yaml\`, the \`workspaces\` of the root \`package.json\`, \`turbo.json\`, \`nx.json\`, \`lerna.json\`, \`go.work\`, the \`[workspace]\` of the root \`Cargo.toml\`, \`settings.gradle(.kts)\`, the \`<modules>\` of the root \`pom.xml\` or a \`*.sln\`.
- The changed files are \`git diff --name-only <base>...HEAD\` plus \`git status --porcelain\` for what is not committed yet.

## Node.js
- One package: \`pnpm --filter <name> <script>\` (or \`--filter ./packages/a\`), \`npm run <script> -w <name>\`, \`yarn workspace <name> <script>\`, or the script run inside the package's folder.
- One test file, run from its package's folder with \`pnpm exec\` or \`npx\`: \`vitest run src/a.spec.ts\`, \`jest src/a.spec.ts\`, \`rstest run src/a.spec.ts\`, \`mocha test/a.spec.js\`, \`node --test test/a.test.js\`. One test by name: \`-t "name"\` (vitest, jest, rstest), \`--grep "name"\` (mocha). Leave coverage off for a single file, since a global threshold fails on a partial run.
- Lint and format one file: \`eslint src/a.ts\`, \`biome check src/a.ts\`, \`prettier --check src/a.ts\`.
- Type check: \`tsc --noEmit -p <package>/tsconfig.json\`, \`tsc -b\` for project references, \`vue-tsc --noEmit\` for Vue, or the package's \`typecheck\` script. It cannot be scoped to a file: \`tsc src/a.ts\` ignores the \`tsconfig.json\`.

## Workspace Orchestrators
- turbo: \`turbo run test lint --filter=<name>\`; \`--filter=...<name>\` adds the packages that depend on it, \`--filter=[<base>]\` selects the packages changed since \`<base>\`.
- nx: \`nx run <project>:test\`, \`nx affected -t test lint --base=<base>\`, \`nx show projects --affected --base=<base>\` to list them.
- lerna: \`lerna run test --scope <name>\`, \`lerna run test --since <base>\`.
- pnpm alone: \`pnpm --filter "[<base>]" test\` for the changed packages, \`"...[<base>]"\` to add their dependents.

## Python
- Run inside the project's environment: \`uv run <cmd>\`, \`poetry run <cmd>\`, \`hatch run <cmd>\`, or \`.venv/bin/<cmd>\`. In a uv workspace, \`uv run --package <name> <cmd>\`.
- pytest: \`pytest tests/test_a.py\`, \`pytest tests/test_a.py::test_name\`, \`-k name\`; \`--no-cov\` for a single file when coverage has a threshold; one package: \`pytest <package>/tests\`.
- Lint and format: \`ruff check a.py\`, \`ruff format --check a.py\` (or \`black --check\`, \`flake8\`, \`isort --check\`).
- Types: \`mypy a.py\` (checks it and what it imports), \`mypy <package>\`, \`pyright a.py\`.
- \`tox -e <env>\` and \`nox -s <session>\` run the full suite of a package.

## Go
- One package: \`go test ./pkg/a\`, one test \`go test ./pkg/a -run TestName\`, the module \`go test ./...\` from its root (each module of a \`go.work\` on its own). \`-count=1\` skips the test cache.
- \`go vet ./pkg/a\`, \`gofmt -l a.go\`, \`golangci-lint run ./pkg/a/...\`.

## Rust
- One crate: \`cargo test -p <crate>\`, one test \`cargo test -p <crate> <name filter>\`, one integration test file \`cargo test -p <crate> --test <file stem>\`.
- \`cargo clippy -p <crate> --all-targets\`, \`cargo fmt -p <crate> -- --check\` (or \`rustfmt --check src/a.rs\`), \`cargo check -p <crate>\`. \`--workspace\` runs them on every crate.

## JVM
- Gradle, through the wrapper: \`./gradlew :<module>:test --tests 'com.acme.AClassTest'\`, the full checks \`./gradlew :<module>:check\` (lint plugins such as \`spotlessCheck\`, \`ktlintCheck\` and \`detekt\` hang from it).
- Maven, through the wrapper: \`./mvnw -pl <module> test -Dtest=AClassTest\`, the full checks \`./mvnw -pl <module> verify\`; \`-am\` also builds the modules it depends on, and then needs \`-Dsurefire.failIfNoSpecifiedTests=false\` with \`-Dtest\`.

## .NET
- \`dotnet test <path>/A.Tests.csproj --filter "FullyQualifiedName~AClass"\`, \`dotnet build <project>\`.
- \`dotnet format <project> --verify-no-changes --include src/A.cs\`.
`,
};
