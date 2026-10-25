import { describe, expect, it } from 'vitest';

import { extractUserLanguage, normalizeUserLanguage } from './user-language.util.js';


describe('normalizeUserLanguage', () => {
  it('should trim and collapse whitespace', () => {
    expect(normalizeUserLanguage('  Brazilian \n Portuguese ')).toBe('Brazilian Portuguese');
  });

  it.each([
    ['empty', '   '],
    ['too long', 'x'.repeat(65)],
    ['markup', '<b>Spanish</b>'],
    ['brackets', '[SYSTEM] Spanish'],
    ['backticks', '`Spanish`'],
  ])('should reject %s input', (_, input) => {
    expect(normalizeUserLanguage(input)).toBeUndefined();
  });
});

describe('extractUserLanguage', () => {
  it('should return the response untouched when it has no tag', () => {
    expect(extractUserLanguage('Olá!\n\n\nTudo bem?')).toEqual({ text: 'Olá!\n\n\nTudo bem?' });
  });

  it('should extract the language and remove the tag', () => {
    expect(extractUserLanguage('Olá!\n\n<user_language> Brazilian Portuguese </user_language>\n\n\nTudo bem?')).toEqual({
      language: 'Brazilian Portuguese',
      text: 'Olá!\n\nTudo bem?',
    });
  });

  it('should keep the first valid language and remove every tag', () => {
    expect(extractUserLanguage('<USER_LANGUAGE></USER_LANGUAGE><user_language>Spanish</user_language>Hola<user_language>German</user_language>')).toEqual({
      language: 'Spanish',
      text: 'Hola',
    });
  });

  it('should remove an invalid tag without a language', () => {
    expect(extractUserLanguage('Hi <user_language><b></user_language>')).toEqual({ text: 'Hi' });
  });

  it('should leave tags inside Markdown code alone', () => {
    const response = 'Use `<user_language>French</user_language>` in the protocol.';
    expect(extractUserLanguage(response)).toEqual({ text: response });
  });
});
