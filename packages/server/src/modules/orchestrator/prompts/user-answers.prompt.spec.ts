import { describe, expect, it } from '@rstest/core';

import { buildUserAnswersPrompt } from './user-answers.prompt.js';


const question = { text: 'Which "name"?', options: ['A', 'B'] };

describe('user-answers.prompt', () => {
  it('should repeat each question with the option chosen or the user\'s own text', () => {
    expect(buildUserAnswersPrompt([
      { question, answer: 'A', optionNumber: 1 },
      { question, answer: 'Something else' },
    ])).toBe([
      '<user_answers>',
      '<answer question="Which &quot;name&quot;?" option="1">A</answer>',
      '<answer question="Which &quot;name&quot;?" kind="other">Something else</answer>',
      '</user_answers>',
    ].join('\n'));
  });

  it('should mark the answers assumed while the user was away and attach the files sent', () => {
    const prompt = buildUserAnswersPrompt([
      { question, answer: 'B', optionNumber: 2, timedOut: true },
      { question, answer: '', timedOut: true, attachments: [{ name: 'a.png', path: '/tmp/a.png', contentType: 'image/png', size: 1 }] },
    ]);

    expect(prompt).toContain('<answer question="Which &quot;name&quot;?" option="2" status="timed_out">B</answer>');
    expect(prompt).toContain('<answer question="Which &quot;name&quot;?" status="timed_out">\n<attachment path="/tmp/a.png" name="a.png" type="image/png"/></answer>');
    expect(prompt).toContain('<note>The user was absent and did not reply in time.');
  });
});
