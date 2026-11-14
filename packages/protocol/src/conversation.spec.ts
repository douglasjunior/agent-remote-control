import { conversationStateSchema, conversationSummarySchema } from './conversation.js';


describe('conversation schemas', () => {
  it('accepts a valid summary', () => {
    const summary = {
      id: '1',
      title: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(conversationSummarySchema.safeParse(summary).success).toBe(true);
    expect(conversationSummarySchema.safeParse({ ...summary, archivedAt: '2026-01-02T00:00:00.000Z' }).success).toBe(true);
  });

  it('rejects a summary with a malformed timestamp or missing fields', () => {
    expect(conversationSummarySchema.safeParse({ id: '1', title: 'T', createdAt: 'x', updatedAt: 'y' }).success)
      .toBe(false);
    expect(conversationSummarySchema.safeParse({ id: '1' }).success).toBe(false);
  });

  it.each(['idle', 'queued', 'running'])('accepts state %s', (state) => {
    expect(conversationStateSchema.safeParse(state).success).toBe(true);
  });

  it('rejects an unknown state', () => {
    expect(conversationStateSchema.safeParse('paused').success).toBe(false);
  });
});
