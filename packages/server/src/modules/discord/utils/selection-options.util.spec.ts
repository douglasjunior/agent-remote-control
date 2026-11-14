import { toSelectionOptions } from './selection-options.util.js';


describe('toSelectionOptions', () => {
  it('should number the options from 1 and rename name to label', () => {
    expect(toSelectionOptions([{ id: 'a', name: 'A', description: 'First' }, { id: 'b', name: 'B' }])).toEqual([
      { index: 1, id: 'a', label: 'A', description: 'First' },
      { index: 2, id: 'b', label: 'B' },
    ]);
  });
});
