import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { TurnActivity } from '../models/turn-activity.model.js';

import { AgentProtocolService } from './agent-protocol.service.js';


const service = new AgentProtocolService();

function reading(withAnswers = true) {
  const activities: TurnActivity[] = [];
  const answers: string[] = [];
  const stream = service.stream({
    onActivity: activity => activities.push(activity),
    ...(withAnswers && { onAnswer: (answer: string) => answers.push(answer) }),
  });
  const read = (...items: AgentActivity[]) => items.forEach(item => stream.read(item));
  return { read, activities, answers };
}

const message = (id: string, text: string, extra: { final?: boolean; reasoning?: boolean } = {}): AgentActivity => ({ kind: 'thought', id, text, ...extra });

describe('AgentProtocolService', () => {
  describe('finalResponse', () => {
    it.each([
      ['the content of the envelope', 'Wrapping up. <final_response>Report</final_response>', 'Report'],
      ['the content of every envelope', '<final_response>One.</final_response>\n\n<final_response> </final_response><final_response>Two.</final_response>', 'One.\n\nTwo.'],
      ['an envelope missing its closing tag', '<final_response>Report', 'Report'],
      ['the whole text without an envelope', 'Reading.\n\nDone.', 'Reading.\n\nDone.'],
      ['the text without a stray tag', 'e.\n</final_response>', 'e.'],
      ['an empty text', '', ''],
    ])('reads %s', (_name, written, expected) => {
      expect(service.finalResponse(written)).toBe(expected);
    });
  });

  describe('stream', () => {
    it('passes what is not a thought through', () => {
      const { read, activities, answers } = reading();
      const tool: AgentActivity = { kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'pending' };

      read(tool, { kind: 'steering', id: 's', text: 'more' }, { kind: 'cancelled', id: 'x' });

      expect(activities).toHaveLength(3);
      expect(activities[0]).toBe(tool);
      expect(answers).toEqual([]);
    });

    it('keeps narration in the feed', () => {
      const { read, activities } = reading();

      read(message('m1', 'Reading the code.'), message('m1', 'Reading the code.', { final: true }));

      expect(activities).toEqual([
        { kind: 'thought', id: 'm1', text: 'Reading the code.' },
        { kind: 'thought', id: 'm1', text: 'Reading the code.', final: true },
      ]);
    });

    it('takes back the entry of a message that only holds the final response', () => {
      const { read, activities } = reading();

      read(message('m1', '<final_'), message('m1', '<final_response>All '), message('m1', '<final_response>All done.</final_response>'));

      expect(activities).toEqual([{ kind: 'thought', id: 'm1', text: '', removed: true }]);
    });

    it('settles the entry to the prose before the envelope', () => {
      const { read, activities } = reading();

      read(message('m1', 'Wrapping up. <final_response>Report'), message('m1', 'Wrapping up. <final_response>Report.'));

      expect(activities).toEqual([{ kind: 'thought', id: 'm1', text: 'Wrapping up.', final: true }]);
    });

    it('holds back an envelope opening being typed out of the narration', () => {
      const { read, activities } = reading();

      read(message('m1', 'Almost there. <final_re'));

      expect(activities).toEqual([{ kind: 'thought', id: 'm1', text: 'Almost there.' }]);
    });

    it('shows nothing for a block that is only a partial tag', () => {
      const { read, activities } = reading();

      read(message('m1', '<final_'));

      expect(activities).toEqual([]);
    });

    it('does not read the envelope inside reasoning', () => {
      const { read, activities, answers } = reading();

      read(message('t1', '<final_response>draft</final_response>', { reasoning: true }));

      expect(activities).toEqual([{ kind: 'thought', id: 't1', text: '<final_response>draft</final_response>' }]);
      expect(answers).toEqual([]);
    });

    it('keeps earlier narration out of the answer once a message has an envelope', () => {
      const { read, answers } = reading();

      read(message('m1', 'Let me look.'), message('m2', '<final_response>Done.'));

      expect(answers).toEqual(['Let me look.', 'Done.']);
    });

    it('emits the answer whole at every change, holding back a closing tag being typed', () => {
      const { read, answers } = reading();

      read(
        message('m1', '<final_response>All'),
        message('m1', '<final_response>All done.</fi'),
        message('m1', '<final_response>All done.</final_response>'),
        message('m1', '<final_response>All done.</final_response>\n'),
      );

      expect(answers).toEqual(['All', 'All done.']);
    });

    it('emits what the agent says while no message has an envelope', () => {
      const { read, answers } = reading();

      read(message('m1', 'Hello'), message('m1', 'Hello world'), message('m2', 'Bye.'));

      expect(answers).toEqual(['Hello', 'Hello world', 'Hello world\n\nBye.']);
    });

    it('holds back an envelope opening being typed out of the answer', () => {
      const { read, answers } = reading();

      read(message('m1', 'Almost there. <final_re'));

      expect(answers).toEqual(['Almost there.']);
    });

    it('joins the envelopes of every message', () => {
      const { read, answers } = reading();

      read(message('m1', '<final_response>Part one.</final_response>'), message('m2', '<final_response>Part two.</final_response>'));

      expect(answers).toEqual(['Part one.', 'Part one.\n\nPart two.']);
    });

    it('leaves reasoning out of the answer', () => {
      const { read, answers } = reading();

      read(message('t1', 'Thinking about it.', { reasoning: true }), message('m1', 'Answer.'));

      expect(answers).toEqual(['Answer.']);
    });

    it('reads no answer when nobody asks for it', () => {
      const { read, activities } = reading(false);

      read(message('m1', 'Hello'));

      expect(activities).toHaveLength(1);
    });
  });
});
