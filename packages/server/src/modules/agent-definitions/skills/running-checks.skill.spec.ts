import { describe, expect, it } from '@rstest/core';

import { skillContext } from '../testing/skill-context.fixture.js';

import { RUNNING_CHECKS_SKILL } from './running-checks.skill.js';


describe('running-checks skill', () => {
  const skill = RUNNING_CHECKS_SKILL.buildContent(skillContext());

  it('should be read by the roles that run or judge the checks of a task', () => {
    expect(RUNNING_CHECKS_SKILL).toMatchObject({ name: 'running-checks', roles: ['DEVELOPER', 'CODE_REVIEWER', 'QA'] });
  });

  it('should say when to read it', () => {
    expect(RUNNING_CHECKS_SKILL.description).toContain('Read it when you do not know how to run a check for one file or one package in this ecosystem.');
  });

  it('should run checks non-interactively through the project scripts', () => {
    expect(skill).toContain('Run every check non-interactively (`CI=1`, no watch mode)');
    expect(skill).toContain('prefer the project\'s own script over the bare tool');
  });

  it('should find the required checks in the CI workflows', () => {
    expect(skill).toContain('A CI workflow lists what a pull request must pass.');
    expect(skill).toContain('the `run:` lines of their steps');
    expect(skill).toContain('Steps that deploy, publish or need secrets are not checks to run locally');
  });

  it('should find the package of a file from its nearest manifest and the workspace declarations', () => {
    expect(skill).toContain('Walk up from the file to the nearest manifest');
    expect(skill).toContain('`pnpm-workspace.yaml`');
    expect(skill).toContain('git diff --name-only <base>...HEAD');
  });

  it('should give the per-file and per-package commands of each ecosystem', () => {
    for (const command of [
      'pnpm --filter <name> <script>',
      'vitest run src/a.spec.ts',
      'rstest run src/a.spec.ts',
      'turbo run test lint --filter=<name>',
      'nx affected -t test lint --base=<base>',
      'pytest tests/test_a.py::test_name',
      'go test ./pkg/a -run TestName',
      'cargo test -p <crate>',
      './gradlew :<module>:test',
      './mvnw -pl <module> test -Dtest=AClassTest',
      'dotnet test <path>/A.Tests.csproj',
    ]) {
      expect(skill).toContain(command);
    }
  });

  it('should warn that the TypeScript type check cannot be scoped to a file', () => {
    expect(skill).toContain('It cannot be scoped to a file: `tsc src/a.ts` ignores the `tsconfig.json`.');
  });
});
