import { describe, expect, it } from 'vitest';

import { AgentAuthRequestService } from './agent-auth-request.service.js';


const choices = [{ agentId: 'claude', displayName: 'Claude Code' }];

describe('AgentAuthRequestService', () => {
  describe('pick', () => {
    it('should remember the offered agents per conversation until cancelled', () => {
      const service = new AgentAuthRequestService();

      service.requestPick('conv-1', choices);

      expect(service.pendingPick('conv-1')).toEqual(choices);
      expect(service.pendingPick('conv-2')).toBeUndefined();
      expect(service.cancelPick('conv-1')).toBe(true);
      expect(service.pendingPick('conv-1')).toBeUndefined();
      expect(service.cancelPick('conv-1')).toBe(false);
    });
  });

  describe('login', () => {
    it('should track a running login that does not wait for a code yet', () => {
      const service = new AgentAuthRequestService();

      service.startLogin('conv-1', 'claude');

      expect(service.runningLogin('conv-1')).toBe('claude');
      expect(service.loginAwaitingCode('conv-1')).toBeUndefined();
    });

    it('should report the agent whose login waits for a code', () => {
      const service = new AgentAuthRequestService();
      service.startLogin('conv-1', 'claude');

      service.awaitCode('conv-1');

      expect(service.loginAwaitingCode('conv-1')).toBe('claude');
    });

    it('should ignore a code request without a login', () => {
      const service = new AgentAuthRequestService();

      service.awaitCode('conv-1');

      expect(service.loginAwaitingCode('conv-1')).toBeUndefined();
    });

    it('should forget a login once it ended', () => {
      const service = new AgentAuthRequestService();
      service.startLogin('conv-1', 'claude');
      service.awaitCode('conv-1');

      service.endLogin('conv-1');

      expect(service.runningLogin('conv-1')).toBeUndefined();
      expect(service.loginAwaitingCode('conv-1')).toBeUndefined();
    });
  });
});
