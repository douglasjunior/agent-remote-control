import { describe, expect, it, rs } from '@rstest/core';

import { PromptCancelledError } from '../../agent/ports/agent.port.js';

import { ConversationTurn, type JoinOutcome, PendingMessage } from './conversation-turn.model.js';


const message = (text: string) => {
  const outcomes: JoinOutcome[] = [];
  const onDelivery = rs.fn();
  const pending = new PendingMessage(text, { conversationId: 'c', userId: 'u', prompt: text, workspacePath: '/w', agentRole: 'CEO', onDelivery }, outcome => outcomes.push(outcome));
  return { pending, outcomes, onDelivery };
};

describe('PendingMessage', () => {
  it('should tell its channel once that it waits', () => {
    const { pending, onDelivery } = message('hi');

    pending.markQueued();
    pending.markQueued();

    expect(onDelivery.mock.calls).toEqual([['queued']]);
  });

  it.each(['steered', 'delivered'] as const)('should join the turn once %s', (delivery) => {
    const { pending, outcomes, onDelivery } = message('hi');

    pending.reached(delivery);

    expect(onDelivery).toHaveBeenCalledWith(delivery);
    expect(outcomes).toEqual([{ kind: 'joined' }]);
  });

  it('should tell its channel it was cancelled', () => {
    const { pending, outcomes, onDelivery } = message('hi');

    pending.cancel();

    expect(onDelivery).toHaveBeenCalledWith('cancelled');
    expect(outcomes).toEqual([{ kind: 'cancelled' }]);
  });

  it('should drive the turn it is handed, without a delivery yet', () => {
    const { pending, outcomes, onDelivery } = message('hi');
    const turn = new ConversationTurn();

    pending.drive(turn);

    expect(outcomes).toEqual([{ kind: 'drive', turn }]);
    expect(onDelivery).not.toHaveBeenCalled();
  });

  it('should work for a channel that does not follow deliveries', () => {
    const pending = new PendingMessage('hi', { conversationId: 'c', userId: 'u', prompt: 'hi', workspacePath: '/w', agentRole: 'CEO' }, () => undefined);

    expect(() => {
      pending.markQueued();
      pending.reached('delivered');
      pending.cancel();
    }).not.toThrow();
  });
});

describe('ConversationTurn', () => {
  it('should keep the messages of its inbox in order until a prompt takes them', () => {
    const turn = new ConversationTurn();
    const one = message('one');
    const two = message('two');

    turn.enqueue(one.pending);
    turn.enqueue(two.pending);

    expect(turn.hasInbox).toBe(true);
    expect(turn.joined).toEqual(['one', 'two']);
    expect(turn.take()).toEqual([one.pending, two.pending]);
    expect(turn.hasInbox).toBe(false);
  });

  it('should put messages a steering did not deliver back in front of the others', () => {
    const turn = new ConversationTurn();
    const one = message('one');
    const two = message('two');
    turn.enqueue(one.pending);
    const taken = turn.take();
    turn.enqueue(two.pending);

    turn.putBack(taken);

    expect(turn.take()).toEqual([one.pending, two.pending]);
  });

  it('should start with the messages handed over from the turn before', () => {
    const one = message('one');

    const turn = new ConversationTurn([one.pending]);

    expect(turn.joined).toEqual(['one']);
    expect(turn.take()).toEqual([one.pending]);
  });

  it('should mark every waiting message queued', () => {
    const turn = new ConversationTurn();
    const one = message('one');
    turn.enqueue(one.pending);

    turn.markQueued();

    expect(one.onDelivery).toHaveBeenCalledWith('queued');
  });

  it('should keep what the CEO read and hand the steered messages to the prompt they joined once', () => {
    const turn = new ConversationTurn();

    turn.markRead(['delivered'], false);
    turn.markRead(['steered'], true);

    expect(turn.read).toEqual(['delivered', 'steered']);
    expect(turn.takeSteered()).toEqual(['steered']);
    expect(turn.takeSteered()).toEqual([]);
  });

  it('should keep its open work with the updates it resumed with and every message that joined', () => {
    const turn = new ConversationTurn();
    expect(turn.openWork).toBeUndefined();

    turn.keepWork('w-1', ['earlier']);
    turn.enqueue(message('later').pending);

    expect(turn.openWork).toEqual({ id: 'w-1', updates: ['earlier', 'later'] });
    turn.keepWork('w-2');
    expect(turn.openWork).toEqual({ id: 'w-2', updates: ['later'] });
  });

  it('should wake whoever waits for a message as one arrives', async () => {
    const turn = new ConversationTurn();
    let woken = false;
    const arrival = turn.arrival().then(() => {
      woken = true;
    });
    await Promise.resolve();
    expect(woken).toBe(false);

    turn.enqueue(message('one').pending);
    await arrival;

    expect(woken).toBe(true);
    await expect(turn.arrival()).resolves.toBeUndefined();
  });

  it('should drain its inbox and wake the wait when cancelled', async () => {
    const turn = new ConversationTurn();
    const arrival = turn.arrival();
    const one = message('one');
    turn.enqueue(one.pending);
    const other = new ConversationTurn();
    const otherArrival = other.arrival();

    expect(other.cancel()).toEqual([]);
    await otherArrival;
    expect(turn.cancel()).toEqual([one.pending]);

    await arrival;
    expect(turn.isCancelled).toBe(true);
    expect(() => turn.throwIfCancelled()).toThrow(PromptCancelledError);
    await expect(turn.arrival()).resolves.toBeUndefined();
    expect(() => new ConversationTurn().throwIfCancelled()).not.toThrow();
  });
});
