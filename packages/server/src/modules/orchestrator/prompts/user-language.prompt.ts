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

/** The agent's final response and questions reach the user unchanged, while the server reads its tags and verdict word as written. */
export function buildAgentLanguagePrompt(language: string): string {
  return [
    '[USER_LANGUAGE]',
    `Your final response and your questions are shown to the user as you write them: write them in ${language}. Protocol tags, and the verdict word that opens a final answer, are written exactly as your instructions show them, in English, whatever the language of the rest. Code, commits and project files follow the project's own conventions.`,
  ].join('\n');
}
