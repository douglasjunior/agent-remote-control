import { AT } from '../test/render-app.js';

import { skillLabel, stepLabel, toolLabel } from './tool-label.js';


describe('toolLabel', () => {
  it.each([
    ['Read file', 'Reading files'],
    ['Edit src/app.ts', 'Editing code'],
    ['grep "login"', 'Searching the project'],
    ['pnpm test', 'Running tests'],
    ['git commit -m x', 'Working with Git'],
    ['pnpm build', 'Running project commands'],
    ['curl https://example.com', 'Looking something up online'],
    ['Run script', 'Running a command'],
  ])('describes %j as %j', (title, label) => {
    expect(toolLabel(title)).toBe(label);
  });

  it('keeps a title it does not know', () => {
    expect(toolLabel('Summon dragon')).toBe('Summon dragon');
  });
});

describe('stepLabel', () => {
  it('describes each kind of step', () => {
    expect(skillLabel('read')).toBe('Reading a skill');
    expect(skillLabel('write')).toBe('Writing a skill');
    expect(stepLabel({ id: 's', at: AT, type: 'skill', role: 'QA', action: 'write', names: ['x'], status: 'completed' })).toBe('Writing a skill');
    expect(stepLabel({ id: 't', at: AT, type: 'tool', role: 'QA', title: 'Read file', status: 'completed' })).toBe('Reading files');
    expect(stepLabel({ id: 'h', at: AT, type: 'thought', role: 'QA', text: 'Hmm' })).toBe('Thinking');
  });
});
