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
    ])('should read %s', (_name, written, expected) => {
      expect(service.finalResponse(written)).toBe(expected);
    });
  });

  describe('finalResponseBlocks', () => {
    it.each([
      ['no envelope', 'Reading.\n\nDone.', 0],
      ['one envelope with narration around it', 'Wrapping up. <final_response>Report</final_response> Bye.', 1],
      ['one envelope missing its closing tag', '<final_response>Report', 1],
      ['two envelopes', '<final_response>One.</final_response>\nNarration\n<final_response>Two.</final_response>', 2],
      ['an empty text', '', 0],
    ])('should count %s', (_name, written, expected) => {
      expect(service.finalResponseBlocks(written)).toBe(expected);
    });
  });

  describe('stream', () => {
    it('should pass what is not a thought through', () => {
      const { read, activities, answers } = reading();
      const tool: AgentActivity = { kind: 'tool', toolCallId: 'c1', title: 'Read', status: 'pending' };

      read(tool, { kind: 'cancelled', id: 'x' });

      expect(activities).toHaveLength(2);
      expect(activities[0]).toBe(tool);
      expect(answers).toEqual([]);
    });

    it('should keep narration in the feed', () => {
      const { read, activities } = reading();

      read(message('m1', 'Reading the code.'), message('m1', 'Reading the code.', { final: true }));

      expect(activities).toEqual([
        { kind: 'thought', id: 'm1', text: 'Reading the code.' },
        { kind: 'thought', id: 'm1', text: 'Reading the code.', final: true },
      ]);
    });

    it('should take back the entry of a message that only holds the final response', () => {
      const { read, activities } = reading();

      read(message('m1', '<final_'), message('m1', '<final_response>All '), message('m1', '<final_response>All done.</final_response>'));

      expect(activities).toEqual([{ kind: 'thought', id: 'm1', text: '', removed: true }]);
    });

    it('should settle the entry to the prose before the envelope', () => {
      const { read, activities } = reading();

      read(message('m1', 'Wrapping up. <final_response>Report'), message('m1', 'Wrapping up. <final_response>Report.'));

      expect(activities).toEqual([{ kind: 'thought', id: 'm1', text: 'Wrapping up.', final: true }]);
    });

    it('should hold back an envelope opening being typed out of the narration', () => {
      const { read, activities } = reading();

      read(message('m1', 'Almost there. <final_re'));

      expect(activities).toEqual([{ kind: 'thought', id: 'm1', text: 'Almost there.' }]);
    });

    it('should show nothing for a block that is only a partial tag', () => {
      const { read, activities } = reading();

      read(message('m1', '<final_'));

      expect(activities).toEqual([]);
    });

    it('should not read the envelope inside reasoning', () => {
      const { read, activities, answers } = reading();

      read(message('t1', '<final_response>draft</final_response>', { reasoning: true }));

      expect(activities).toEqual([{ kind: 'thought', id: 't1', text: '<final_response>draft</final_response>' }]);
      expect(answers).toEqual([]);
    });

    it('should keep earlier narration out of the answer once a message has an envelope', () => {
      const { read, answers } = reading();

      read(message('m1', 'Let me look.'), message('m2', '<final_response>Done.'));

      expect(answers).toEqual(['Let me look.', 'Done.']);
    });

    it('should emit the answer whole at every change, holding back a closing tag being typed', () => {
      const { read, answers } = reading();

      read(
        message('m1', '<final_response>All'),
        message('m1', '<final_response>All done.</fi'),
        message('m1', '<final_response>All done.</final_response>'),
        message('m1', '<final_response>All done.</final_response>\n'),
      );

      expect(answers).toEqual(['All', 'All done.']);
    });

    it('should emit what the agent says while no message has an envelope', () => {
      const { read, answers } = reading();

      read(message('m1', 'Hello'), message('m1', 'Hello world'), message('m2', 'Bye.'));

      expect(answers).toEqual(['Hello', 'Hello world', 'Hello world\n\nBye.']);
    });

    it('should hold back an envelope opening being typed out of the answer', () => {
      const { read, answers } = reading();

      read(message('m1', 'Almost there. <final_re'));

      expect(answers).toEqual(['Almost there.']);
    });

    it('should join the envelopes of every message', () => {
      const { read, answers } = reading();

      read(message('m1', '<final_response>Part one.</final_response>'), message('m2', '<final_response>Part two.</final_response>'));

      expect(answers).toEqual(['Part one.', 'Part one.\n\nPart two.']);
    });

    it('should leave reasoning out of the answer', () => {
      const { read, answers } = reading();

      read(message('t1', 'Thinking about it.', { reasoning: true }), message('m1', 'Answer.'));

      expect(answers).toEqual(['Answer.']);
    });

    it('should read no answer when nobody asks for it', () => {
      const { read, activities } = reading(false);

      read(message('m1', 'Hello'));

      expect(activities).toHaveLength(1);
    });
  });

  describe('strayTags', () => {
    it('should name the protocol tags written outside the final response envelope, once each', () => {
      expect(service.strayTags('<artifact_list status="all"/>\nChecking.\n<artifact_list/><DELEGATE role="X">\n<final_response>On it.</final_response>')).toEqual(['artifact_list', 'delegate']);
    });

    it('should find nothing without an envelope, inside it or in Markdown code', () => {
      expect(service.strayTags('<artifact_list/> On it.')).toEqual([]);
      expect(service.strayTags('Use `<delegate>` like this.\n<final_response><artifact_read id="T-1"/></final_response>')).toEqual([]);
    });
  });

  describe('visibleReply', () => {
    it('should leave out artifact requests and their bodies', () => {
      expect(service.visibleReply('Checking the board.\n<artifact_list/>\n<artifact_create type="task" title="x"><section name="overview">Why</section></artifact_create>')).toBe('Checking the board.');
      expect(service.visibleReply('Checking.\n<artifact_upd')).toBe('Checking.');
    });

    it('should keep a plain reply', () => {
      expect(service.visibleReply('Done. Everything works.')).toBe('Done. Everything works.');
    });

    it('should remove the user language tag', () => {
      expect(service.visibleReply('<user_language>Portuguese</user_language>\n\nOlá!')).toBe('Olá!');
    });

    it('should remove delegations with their task and keep the note around them', () => {
      const response = 'Starting now.\n\n<delegate role="DEVELOPER" project="app">Build it\n\nwith care.</delegate>\n\nBack soon.';

      expect(service.visibleReply(response)).toBe('Starting now.\n\nBack soon.');
    });

    it('should remove questions with their options', () => {
      const response = 'I need a decision.\n<question rationale="scope">Which one?<option>A</option><option>B</option></question>';

      expect(service.visibleReply(response)).toBe('I need a decision.');
    });

    it('should remove attachments, closed or self-closing', () => {
      expect(service.visibleReply('Here.\n<attachment path="/a.png">Shot</attachment>\n<attachment path="/b.png"/>')).toBe('Here.');
    });

    it('should match tag names regardless of case', () => {
      expect(service.visibleReply('A<DELEGATE role="X">task</Delegate>B')).toBe('AB');
    });

    it('should hide everything after a tag that is not closed yet', () => {
      expect(service.visibleReply('Note.\n<delegate role="DEVELOPER">Build the')).toBe('Note.');
    });

    it.each([
      ['<', 'Hello'],
      ['<de', 'Hello'],
      ['<delegate', 'Hello'],
      ['<delegate role="DEV', 'Hello'],
      ['<delegate role="DEV"/', 'Hello'],
      ['<user_lang', 'Hello'],
    ])('should hold back the tag being typed (%s)', (typed, expected) => {
      expect(service.visibleReply(`Hello ${typed}`)).toBe(expected);
    });

    it.each(['a < b', 'I <3 this', 'Use <div> here', '<b'])('should show a "<" that cannot start a protocol tag (%s)', (text) => {
      expect(service.visibleReply(text)).toBe(text);
    });

    it('should keep tags quoted in Markdown code', () => {
      const response = 'Write `<delegate role="X">task</delegate>` like this:\n\n```xml\n<question>Q<option>A</option></question>\n```';

      expect(service.visibleReply(response)).toBe(response);
    });

    it('should keep a tag being typed inside an open code fence', () => {
      expect(service.visibleReply('```xml\n<dele')).toBe('```xml\n<dele');
    });

    it('should collapse the blank lines a removed tag leaves', () => {
      expect(service.visibleReply('A\n\n<user_language>en</user_language>\n\n\n\nB')).toBe('A\n\nB');
    });

    it('should be empty while only a tag has been written', () => {
      expect(service.visibleReply('<user_language>pt</user_language>')).toBe('');
    });
  });
});
