export const DEFAULT_USER_LANGUAGE = 'English';

/** Sent to the CEO while no language is stored; the backend stores the tag's language, or English without it. */
export function buildLanguageDetectionPrompt(): string {
  return [
    '[USER_LANGUAGE]',
    'The user\'s language is not known yet. Write everything shown to the user in the language of the user\'s message, and add <user_language>language name in English</user_language> to your response, such as <user_language>Brazilian Portuguese</user_language>. Leave the tag out when the message does not make the language clear.',
  ].join('\n');
}

export function buildCeoLanguagePrompt(language: string): string {
  return [
    '[USER_LANGUAGE]',
    `Write everything shown to the user in ${language}: answers, progress notes, questions and options. Write delegation specifications in English.`,
  ].join('\n');
}

/** The agent's final response and questions reach the user unchanged. */
export function buildAgentLanguagePrompt(language: string): string {
  return [
    '[USER_LANGUAGE]',
    `Your final response and your questions are shown to the user as you write them: write them in ${language}. Code, commits and project files follow the project's own conventions.`,
  ].join('\n');
}
