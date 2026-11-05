import { currentLogConversation, runInLogConversation } from './log-conversation.util.js';


describe('runInLogConversation', () => {
  it('names the conversation inside the work, across awaits, and not outside it', async () => {
    const seen = await runInLogConversation('c1', async () => {
      await Promise.resolve();
      return currentLogConversation();
    });

    expect(seen).toBe('c1');
    expect(currentLogConversation()).toBeUndefined();
  });

  it('keeps parallel conversations apart', async () => {
    const seenIn = (id: string) => runInLogConversation(id, async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return currentLogConversation();
    });

    await expect(Promise.all([seenIn('a'), seenIn('b')])).resolves.toEqual(['a', 'b']);
  });

  it('runs the work without a conversation when there is none', () => {
    expect(runInLogConversation(undefined, () => currentLogConversation())).toBeUndefined();
  });
});
