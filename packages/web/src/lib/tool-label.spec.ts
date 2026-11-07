import { toolLabel } from './tool-label.js';


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
