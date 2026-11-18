import { afterEach, describe, expect, it } from '@rstest/core';

import { readNonNegativeInteger } from './env-number.util.js';


describe('readNonNegativeInteger', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return the fallback when the variable is unset or blank', () => {
    delete process.env.ARC_TEST_NUMBER;
    expect(readNonNegativeInteger('ARC_TEST_NUMBER', 7)).toBe(7);

    process.env.ARC_TEST_NUMBER = '  ';
    expect(readNonNegativeInteger('ARC_TEST_NUMBER', 7)).toBe(7);
  });

  it('should read the trimmed value, rounded down', () => {
    process.env.ARC_TEST_NUMBER = ' 12.9 ';

    expect(readNonNegativeInteger('ARC_TEST_NUMBER', 7)).toBe(12);
  });

  it('should accept zero', () => {
    process.env.ARC_TEST_NUMBER = '0';

    expect(readNonNegativeInteger('ARC_TEST_NUMBER', 7)).toBe(0);
  });

  it.each(['abc', '-1', 'Infinity'])('should return the fallback for %s', (value) => {
    process.env.ARC_TEST_NUMBER = value;

    expect(readNonNegativeInteger('ARC_TEST_NUMBER', 7)).toBe(7);
  });
});
