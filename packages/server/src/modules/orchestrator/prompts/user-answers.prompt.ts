import type { AnsweredQuestion } from '../models/user-question.model.js';
import { escapeTagAttribute } from '../utils/protocol-tag.util.js';


const TIMED_OUT_NOTE = '<note>The user was absent and did not reply in time. Answers with status="timed_out" are not the user\'s own: the recommended option was assumed for now, and an answer with no option had no recommendation, so decide how to proceed yourself.</note>';

/** Repeats each question, because the agent's context may have been compacted while the user answered. */
export function buildUserAnswersPrompt(answers: readonly AnsweredQuestion[]): string {
  const lines = answers.map(({ question, answer, optionNumber, timedOut, attachments = [] }) => {
    const choice = [
      optionNumber === undefined ? (timedOut ? '' : 'kind="other"') : `option="${optionNumber}"`,
      timedOut ? 'status="timed_out"' : '',
    ].filter(Boolean).join(' ');
    const files = attachments.map(file => `\n<attachment path="${escapeTagAttribute(file.path)}" name="${escapeTagAttribute(file.name)}" type="${escapeTagAttribute(file.contentType)}"/>`);
    return `<answer question="${escapeTagAttribute(question.text)}" ${choice}>${answer}${files.join('')}</answer>`;
  });
  const note = answers.some(({ timedOut }) => timedOut) ? [TIMED_OUT_NOTE] : [];
  return ['<user_answers>', ...lines, ...note, '</user_answers>'].join('\n');
}
