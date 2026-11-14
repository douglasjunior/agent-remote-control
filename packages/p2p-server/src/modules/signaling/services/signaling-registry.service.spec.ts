import type { ToClientSignal, ToHostSignal } from '@agent-remote-control/protocol/signaling';

import type { SignalingSession } from '../models/signaling-session.model.js';
import { FakeSignalingSocket } from '../testing/fake-signaling-socket.js';

import { SignalingRegistryService } from './signaling-registry.service.js';


describe('SignalingRegistryService', () => {
  const registry = new SignalingRegistryService();
  const host = new FakeSignalingSocket<ToHostSignal>();
  const client = new FakeSignalingSocket<ToClientSignal>();
  const session = (id: string, instanceId: string): SignalingSession =>
    ({ id, instanceId, client, fingerprint: 'fp', state: 'requested', candidates: 0 });

  it('should remove a host with its sessions and keep the sessions of other instances', () => {
    registry.setHost({ instanceId: 'a', socket: host, protocolVersion: 1 });
    registry.addSession(session('s1', 'a'));
    registry.addSession(session('s2', 'b'));

    expect(registry.sessionCount('a')).toBe(1);
    expect(registry.removeHost(host).map(removed => removed.id)).toEqual(['s1']);
    expect(registry.host('a')).toBeUndefined();
    expect(registry.session('s1')).toBeUndefined();
    expect(registry.sessionCount('a')).toBe(0);
    expect(registry.session('s2')).toBeDefined();
  });

  it('should remove nothing for a socket that holds no instance or whose instance went to another socket', () => {
    const older = new FakeSignalingSocket<ToHostSignal>();
    registry.setHost({ instanceId: 'c', socket: older, protocolVersion: 1 });
    registry.setHost({ instanceId: 'c', socket: host, protocolVersion: 1 });

    expect(registry.removeHost(new FakeSignalingSocket<ToHostSignal>())).toEqual([]);
    expect(registry.removeHost(older)).toEqual([]);
    expect(registry.host('c')?.socket).toBe(host);
  });

  it('should update a session and ignore an unknown one', () => {
    registry.addSession(session('s3', 'a'));
    registry.updateSession('s3', { state: 'offered', candidates: 2 });
    registry.updateSession('unknown', { state: 'offered' });

    expect(registry.session('s3')).toMatchObject({ state: 'offered', candidates: 2 });
    expect(registry.removeSession('s3')?.id).toBe('s3');
    expect(registry.removeSession('s3')).toBeUndefined();
  });
});
