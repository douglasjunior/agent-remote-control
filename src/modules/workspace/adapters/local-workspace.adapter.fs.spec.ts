import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalWorkspaceAdapter } from './local-workspace.adapter.js';


/** Runs against the real file system, so it checks the link type of whichever OS runs the suite. */
describe('LocalWorkspaceAdapter on the real file system', () => {
  let baseDirectory: string;
  let adapter: LocalWorkspaceAdapter;

  beforeEach(() => {
    baseDirectory = mkdtempSync(join(tmpdir(), 'arc-workspace-'));
    adapter = new LocalWorkspaceAdapter(baseDirectory);
  });

  afterEach(() => {
    rmSync(baseDirectory, { recursive: true, force: true });
  });

  const linkPath = () => join(baseDirectory, '.claude', 'skills');

  it('should expose the skills written under .agents through the .claude link', async () => {
    await adapter.writeFile('.agents/skills/team/SKILL.md', 'team skill');

    await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

    expect(lstatSync(linkPath()).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(linkPath(), 'team', 'SKILL.md'), 'utf8')).toBe('team skill');
  });

  it('should keep working when called again on every start', async () => {
    await adapter.writeFile('.agents/skills/team/SKILL.md', 'v1');
    await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

    await adapter.writeFile('.agents/skills/team/SKILL.md', 'v2');
    await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

    expect(readFileSync(join(linkPath(), 'team', 'SKILL.md'), 'utf8')).toBe('v2');
  });

  it('should repoint a link that targets another directory', async () => {
    mkdirSync(join(baseDirectory, 'old'));
    mkdirSync(join(baseDirectory, '.claude'));
    symlinkSync(join(baseDirectory, 'old'), linkPath(), process.platform === 'win32' ? 'junction' : 'dir');
    await adapter.writeFile('.agents/skills/team/SKILL.md', 'current');

    await adapter.ensureSymlink('.claude/skills', '../.agents/skills');

    expect(readFileSync(join(linkPath(), 'team', 'SKILL.md'), 'utf8')).toBe('current');
  });

  it('should leave a real directory in place untouched', async () => {
    await adapter.writeFile('.claude/skills/own/SKILL.md', 'user skill');

    await expect(adapter.ensureSymlink('.claude/skills', '../.agents/skills')).rejects.toThrow(
      'Cannot create symlink, a file or directory already exists',
    );
    expect(readFileSync(join(linkPath(), 'own', 'SKILL.md'), 'utf8')).toBe('user skill');
  });

  it('should list only visible project folders', async () => {
    mkdirSync(join(baseDirectory, 'my-app'));
    mkdirSync(join(baseDirectory, '.agents'));
    writeFileSync(join(baseDirectory, 'AGENTS.md'), 'guide');

    await expect(adapter.listProjectFolders()).resolves.toEqual(['my-app']);
  });
});
