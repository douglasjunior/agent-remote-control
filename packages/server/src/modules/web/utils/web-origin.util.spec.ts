import { isOriginAllowed, parseAllowedOrigins } from './web-origin.util.js';


describe('parseAllowedOrigins', () => {
  it('splits, trims and drops empty entries and trailing slashes', () => {
    expect(parseAllowedOrigins(' http://a.test/ , ,http://b.test ')).toEqual(
      new Set(['http://a.test', 'http://b.test']),
    );
  });

  it('returns an empty set when unset', () => {
    expect(parseAllowedOrigins(undefined).size).toBe(0);
  });
});

describe('isOriginAllowed', () => {
  const allowed = new Set(['http://localhost:5173']);

  it.each([
    ['same host', 'http://localhost:3000', 'localhost:3000', true],
    ['listed origin', 'http://localhost:5173', 'localhost:3000', true],
    ['foreign origin', 'http://evil.test', 'localhost:3000', false],
    ['same hostname on another port', 'http://localhost:9999', 'localhost:3000', false],
    ['missing origin', undefined, 'localhost:3000', false],
    ['malformed origin', 'not a url', 'localhost:3000', false],
    ['missing host', 'http://evil.test', undefined, false],
  ])('%s', (_label, origin, host, expected) => {
    expect(isOriginAllowed(origin, host, allowed)).toBe(expected);
  });
});
