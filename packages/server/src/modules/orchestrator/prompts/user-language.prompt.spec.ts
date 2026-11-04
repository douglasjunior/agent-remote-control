import { describe, expect, it } from 'vitest';

import {
  buildAgentLanguagePrompt,
  buildCeoLanguagePrompt,
  buildLanguageDetectionPrompt,
  DEFAULT_USER_LANGUAGE,
} from './user-language.prompt.js';


describe('user language prompts', () => {
  it('should default to English', () => {
    expect(DEFAULT_USER_LANGUAGE).toBe('English');
  });

  it('should ask the CEO to report the language through the protocol tag', () => {
    expect(buildLanguageDetectionPrompt()).toContain('<user_language>language name in English</user_language>');
  });

  it('should keep delegation specifications in English for the CEO', () => {
    const prompt = buildCeoLanguagePrompt('Spanish');
    expect(prompt).toContain('shown to the user in Spanish');
    expect(prompt).toContain('delegation specifications in English');
  });

  it('should ask agents to answer the user in the language', () => {
    expect(buildAgentLanguagePrompt('Spanish')).toContain('write them in Spanish');
  });
});
