import { describe, expect, it } from 'vitest';

import { QuestionParserService } from './question-parser.service.js';


describe('QuestionParserService', () => {
  const parser = new QuestionParserService();

  it('should report no questions when the response has no question tag', () => {
    expect(parser.parse('All done.')).toEqual({ kind: 'none' });
  });

  it('should read the questions, their options and rationale, keeping the text around them as the message', () => {
    const response = [
      'Here is what I understood.',
      '',
      '<question rationale="It decides who sees the request.">Who approves a refund?',
      '<option>The manager</option>',
      '<OPTION>Finance</OPTION>',
      '</question>',
      '',
      '',
      '',
      '<question rationale=\'\'>What is the maximum amount?</question>',
      'Answer when you can.',
    ].join('\n');

    expect(parser.parse(response)).toEqual({
      kind: 'questions',
      message: 'Here is what I understood.\n\nAnswer when you can.',
      questions: [
        { text: 'Who approves a refund?', rationale: 'It decides who sees the request.', options: ['The manager', 'Finance'] },
        { text: 'What is the maximum amount?', options: [] },
      ],
    });
  });

  it.each([
    ['an option outside a question', '<option>A</option>', 'outside a <question>'],
    ['a closing question tag without its opening', 'Text </question>', 'without its opening <question>'],
    ['an unknown question attribute', '<question kind="x">Q?</question>', 'Unknown attribute "kind"'],
    ['an unclosed question', '<question>Q?', 'must be closed with </question>'],
    ['a question without text', '<question><option>A</option></question>', 'has no text'],
    ['a closing option tag without its opening', '<question>Q? A</option></question>', 'without its opening <option>'],
    ['an option with attributes', '<question>Q?<option value="1">A</option></question>', 'takes no attributes'],
    ['an unclosed option', '<question>Q?<option>A</question>', 'must be closed with </option>'],
    ['an empty option', '<question>Q?<option> </option></question>', 'is empty'],
  ])('should reject %s', (_case, response, reason) => {
    const parsed = parser.parse(response);

    expect(parsed.kind).toBe('invalid');
    expect(parsed).toMatchObject({ reason: expect.stringContaining(reason) });
  });
});
