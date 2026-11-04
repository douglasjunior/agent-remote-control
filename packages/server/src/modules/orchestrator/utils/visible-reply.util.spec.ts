import { visibleReply } from './visible-reply.util.js';


describe('visibleReply', () => {
  it('keeps a plain reply', () => {
    expect(visibleReply('Done. Everything works.')).toBe('Done. Everything works.');
  });

  it('removes the user language tag', () => {
    expect(visibleReply('<user_language>Portuguese</user_language>\n\nOlá!')).toBe('Olá!');
  });

  it('removes delegations with their task and keeps the note around them', () => {
    const response = 'Starting now.\n\n<delegate role="DEVELOPER" project="app">Build it\n\nwith care.</delegate>\n\nBack soon.';

    expect(visibleReply(response)).toBe('Starting now.\n\nBack soon.');
  });

  it('removes questions with their options', () => {
    const response = 'I need a decision.\n<question rationale="scope">Which one?<option>A</option><option>B</option></question>';

    expect(visibleReply(response)).toBe('I need a decision.');
  });

  it('removes attachments, closed or self-closing', () => {
    expect(visibleReply('Here.\n<attachment path="/a.png">Shot</attachment>\n<attachment path="/b.png"/>')).toBe('Here.');
  });

  it('matches tag names regardless of case', () => {
    expect(visibleReply('A<DELEGATE role="X">task</Delegate>B')).toBe('AB');
  });

  it('hides everything after a tag that is not closed yet', () => {
    expect(visibleReply('Note.\n<delegate role="DEVELOPER">Build the')).toBe('Note.');
  });

  it.each([
    ['<', 'Hello'],
    ['<de', 'Hello'],
    ['<delegate', 'Hello'],
    ['<delegate role="DEV', 'Hello'],
    ['<delegate role="DEV"/', 'Hello'],
    ['<user_lang', 'Hello'],
  ])('holds back the tag being typed (%s)', (typed, expected) => {
    expect(visibleReply(`Hello ${typed}`)).toBe(expected);
  });

  it.each(['a < b', 'I <3 this', 'Use <div> here', '<b'])('shows a "<" that cannot start a protocol tag (%s)', (text) => {
    expect(visibleReply(text)).toBe(text);
  });

  it('keeps tags quoted in Markdown code', () => {
    const response = 'Write `<delegate role="X">task</delegate>` like this:\n\n```xml\n<question>Q<option>A</option></question>\n```';

    expect(visibleReply(response)).toBe(response);
  });

  it('keeps a tag being typed inside an open code fence', () => {
    expect(visibleReply('```xml\n<dele')).toBe('```xml\n<dele');
  });

  it('collapses the blank lines a removed tag leaves', () => {
    expect(visibleReply('A\n\n<user_language>en</user_language>\n\n\n\nB')).toBe('A\n\nB');
  });

  it('is empty while only a tag has been written', () => {
    expect(visibleReply('<user_language>pt</user_language>')).toBe('');
  });
});
