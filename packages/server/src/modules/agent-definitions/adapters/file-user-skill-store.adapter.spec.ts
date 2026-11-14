import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dataDirectoryAt } from '../../paths/testing/fixed-directories.js';

import { FileUserSkillStoreAdapter } from './file-user-skill-store.adapter.js';


describe('FileUserSkillStoreAdapter', () => {
  let dataDir: string;
  let store: FileUserSkillStoreAdapter;

  const writeSkill = async (folder: string, text: string) => {
    await mkdir(join(dataDir, 'skills', folder), { recursive: true });
    await writeFile(join(dataDir, 'skills', folder, 'SKILL.md'), text);
  };
  const listed = async () => (await store.list()).map(({ buildContent, ...skill }) => ({ ...skill, content: buildContent({ team: [], workspaceDir: '/ws' }) }));

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'arc-skills-'));
    store = new FileUserSkillStoreAdapter(dataDirectoryAt(dataDir));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('lists nothing without a skills folder', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('reads each skill folder, sorted, with its roles in any list form', async () => {
    await writeSkill('zeta', '---\nname: "cypress"\ndescription: \'Testing with Cypress.\'\nroles: [QA, "developer"]\n---\n\n# Cypress\n\nRun it.\n');
    await writeSkill('alpha', '---\ndescription: >\n  Testing a web interface\n  in a real browser.\nroles:\n  - QA\n  - CEO\n# a comment\n---\nOpen the page.');
    await writeSkill('beta', '---\ndescription: |\n  Line one.\n  Line two.\nroles: QA, CODE_REVIEWER\n---\r\nBody');

    expect(await listed()).toEqual([
      { name: 'alpha', description: 'Testing a web interface in a real browser.', roles: ['QA', 'CEO'], content: 'Open the page.' },
      { name: 'beta', description: 'Line one. Line two.', roles: ['QA', 'CODE_REVIEWER'], content: 'Body' },
      { name: 'cypress', description: 'Testing with Cypress.', roles: ['QA', 'developer'], content: '# Cypress\n\nRun it.' },
    ]);
  });

  it('skips folders without a SKILL.md and skills without a description or roles', async () => {
    await mkdir(join(dataDir, 'skills', 'empty'), { recursive: true });
    await writeSkill('no-frontmatter', 'Just text.');
    await writeSkill('no-description', '---\nroles: QA\n---\nBody');
    await writeSkill('no-roles', '---\ndescription: Something.\nroles:\n---\nBody');

    expect(await store.list()).toEqual([]);
  });

  it('deletes the folder of the skill of that name, whatever the folder is called', async () => {
    await writeSkill('my-folder', '---\nname: cypress\ndescription: Cypress.\nroles: QA\n---\nBody');
    await writeSkill('other', '---\ndescription: Other.\nroles: QA\n---\nBody');

    expect(await store.delete('CYPRESS')).toBe(true);
    expect(await store.delete('cypress')).toBe(false);
    expect((await store.list()).map(skill => skill.name)).toEqual(['other']);
    await expect(readFile(join(dataDir, 'skills', 'my-folder', 'SKILL.md'))).rejects.toThrow();
  });

  it('writes a skill it reads back, telling whether it was created', async () => {
    const skill = { name: 'electron-testing', description: 'Testing\nElectron apps.', roles: ['QA', 'DEVELOPER'], content: '# Electron\n\nLaunch it.' };

    expect(await store.write(skill)).toBe(true);
    expect(await store.write({ ...skill, content: '# Electron\n\nLaunch it again.' })).toBe(false);

    expect(await readFile(join(dataDir, 'skills', 'electron-testing', 'SKILL.md'), 'utf-8')).toBe(
      '---\nname: electron-testing\ndescription: Testing Electron apps.\nroles: QA, DEVELOPER\n---\n\n# Electron\n\nLaunch it again.\n',
    );
    expect(await listed()).toEqual([{ name: 'electron-testing', description: 'Testing Electron apps.', roles: ['QA', 'DEVELOPER'], content: '# Electron\n\nLaunch it again.' }]);
  });
});
