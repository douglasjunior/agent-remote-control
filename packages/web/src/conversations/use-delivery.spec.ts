import type { ConversationEntry } from '@agent-remote-control/protocol/conversation-entry';
import { describe, expect, it } from '@rstest/core';
import { renderHook } from '@testing-library/react';

import { useDelivery } from './use-delivery.js';


const AT = '2026-01-01T00:00:00.000Z';
const user: ConversationEntry = { id: 'u1', at: AT, type: 'user_message', text: 'build it' };
const delegation: ConversationEntry = {
  id: 'd1', at: AT, type: 'delegation', delegationId: '1:DEVELOPER', phase: 'started', round: 1, role: 'DEVELOPER', roleName: 'Developer', prompt: 'Do the work', summary: 'Build it',
};
const answer = (status: 'completed' | 'failed' | 'cancelled'): ConversationEntry => ({ id: `a-${status}`, at: AT, type: 'agent_response', status, response: 'done' });

function watch(initial: { entries: ConversationEntry[]; running: boolean }) {
  return renderHook(props => useDelivery(props.entries, props.running), { initialProps: initial });
}

describe('useDelivery', () => {
  it('should count a delivery when a running turn that delegated ends with a completed answer', () => {
    const { result, rerender } = watch({ entries: [user], running: true });
    rerender({ entries: [user, delegation], running: true });
    expect(result.current).toBe(0);

    rerender({ entries: [user, delegation, answer('completed')], running: false });
    expect(result.current).toBe(1);
  });

  it('should count the answer that lands before the conversation goes idle', () => {
    const { result, rerender } = watch({ entries: [user, delegation], running: true });
    rerender({ entries: [user, delegation, answer('completed')], running: true });
    rerender({ entries: [user, delegation, answer('completed')], running: false });

    expect(result.current).toBe(1);
  });

  it('should stay silent for a conversation opened after its turn ended', () => {
    const { result, rerender } = watch({ entries: [user, delegation, answer('completed')], running: false });
    rerender({ entries: [user, delegation, answer('completed'), { ...user, id: 'u0' }], running: false });

    expect(result.current).toBe(0);
  });

  it('should stay silent when the turn never delegated', () => {
    const { result, rerender } = watch({ entries: [user], running: true });
    rerender({ entries: [user, answer('completed')], running: false });

    expect(result.current).toBe(0);
  });

  it.each(['failed', 'cancelled'] as const)('should stay silent when the answer is %s', (status) => {
    const { result, rerender } = watch({ entries: [user, delegation], running: true });
    rerender({ entries: [user, delegation, answer(status)], running: false });

    expect(result.current).toBe(0);
  });

  it('should stay silent while the turn ended without an answer yet', () => {
    const { result, rerender } = watch({ entries: [user, delegation], running: true });
    rerender({ entries: [user, delegation], running: false });

    expect(result.current).toBe(0);
  });

  it('should count each delivery once', () => {
    const { result, rerender } = watch({ entries: [user, delegation], running: true });
    rerender({ entries: [user, delegation, answer('completed')], running: false });
    rerender({ entries: [user, delegation, answer('completed'), { id: 'n', at: AT, type: 'notice', level: 'info', text: 'x' }], running: false });
    expect(result.current).toBe(1);

    const second = { ...user, id: 'u2' };
    rerender({ entries: [second, { ...delegation, id: 'd2' }], running: true });
    rerender({ entries: [second, { ...delegation, id: 'd2' }, { ...answer('completed'), id: 'a2' }], running: false });
    expect(result.current).toBe(2);
  });
});
