import type { ToClientSignal, ToHostSignal } from '@agent-remote-control/protocol/signaling';

import { FakeSignalingSocket } from '../testing/fake-signaling-socket.js';

import { SignalingRegistryService } from './signaling-registry.service.js';


describe('SignalingRegistryService', () => {
  const registry = new SignalingRegistryService();
  const host = new FakeSignalingSocket<ToHostSignal>();
  const client = new FakeSignalingSocket<ToClientSignal>();

  it('should remove a host with its sessions and keep the sessions of other instances', () => {
    registry.setHost({ instanceId: 'a', socket: host, protocolVersion: 1 });
    registry.addSession({ id: 's1', instanceId: 'a', client, offered: false });
    registry.addSession({ id: 's2', instanceId: 'b', client, offered: false });

    expect(registry.sessionCount('a')).toBe(1);
    expect(registry.removeHost(host).map(session => session.id)).toEqual(['s1']);
    expect(registry.host('a')).toBeUndefined();
    expect(registry.session('s1')).toBeUndefined();
    expect(registry.session('s2')).toBeDefined();
  });

  it('should remove nothing for a socket that holds no instance', () => {
    expect(registry.removeHost(new FakeSignalingSocket<ToHostSignal>())).toEqual([]);
  });

  it('should mark a session as offered and ignore an unknown session', () => {
    registry.addSession({ id: 's3', instanceId: 'a', client, offered: false });
    registry.markOffered('s3');
    registry.markOffered('unknown');

    expect(registry.session('s3')?.offered).toBe(true);
    expect(registry.removeSession('s3')?.id).toBe('s3');
    expect(registry.removeSession('s3')).toBeUndefined();
  });
});
