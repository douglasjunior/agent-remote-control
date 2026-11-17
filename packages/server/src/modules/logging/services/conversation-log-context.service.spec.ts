import { ConversationLogContextService } from './conversation-log-context.service.js';


describe('ConversationLogContextService', () => {
  const context = new ConversationLogContextService();

  it('should name the conversation inside the work, across awaits, and not outside it', async () => {
    const seen = await context.run('c1', async () => {
      await Promise.resolve();
      return context.current();
    });

    expect(seen).toBe('c1');
    expect(context.current()).toBeUndefined();
  });

  it('should keep parallel conversations apart', async () => {
    const seenIn = (id: string) => context.run(id, async () => {
      await Promise.resolve();
      return context.current();
    });

    await expect(Promise.all([seenIn('a'), seenIn('b')])).resolves.toEqual(['a', 'b']);
  });

  it('should run the work without a conversation when there is none', () => {
    expect(context.run(undefined, () => context.current())).toBeUndefined();
  });

  it('should not share a conversation between two contexts', () => {
    const other = new ConversationLogContextService();

    expect(context.run('c1', () => other.current())).toBeUndefined();
  });
});
