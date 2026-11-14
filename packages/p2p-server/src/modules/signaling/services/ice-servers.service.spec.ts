import { Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';

import { IceServersService } from './ice-servers.service.js';


describe('IceServersService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('should hand the public STUN servers and no TURN by default', () => {
    const service = new IceServersService();
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service.onModuleInit();

    expect(service.forInstance('i')).toEqual([{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]);
    expect(log).toHaveBeenCalledWith('TURN relay: off');
  });

  it('should hand TURN credentials of coturn\'s REST API that expire with the TTL', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    vi.stubEnv('P2P_STUN_URLS', ' stun:a.test:3478 , ');
    vi.stubEnv('P2P_TURN_URLS', 'turn:t.test:3478?transport=udp,turn:t.test:3478?transport=tcp');
    vi.stubEnv('P2P_TURN_SECRET', 'secret');
    vi.stubEnv('P2P_TURN_TTL_SECONDS', '60');
    const service = new IceServersService();
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service.onModuleInit();

    const username = '1060:inst';
    expect(service.forInstance('inst')).toEqual([
      { urls: ['stun:a.test:3478'] },
      {
        urls: ['turn:t.test:3478?transport=udp', 'turn:t.test:3478?transport=tcp'],
        username,
        credential: createHmac('sha1', 'secret').update(username).digest('base64'),
      },
    ]);
    expect(log).toHaveBeenCalledWith('TURN relay: turn:t.test:3478?transport=udp, turn:t.test:3478?transport=tcp');
  });

  it.each(['', '0', '-5', '1.5', 'abc'])('should keep TURN credentials for a day when the TTL is %j', (ttl) => {
    vi.useFakeTimers({ now: 0 });
    vi.stubEnv('P2P_TURN_URLS', 'turn:t.test:3478');
    vi.stubEnv('P2P_TURN_SECRET', 'secret');
    vi.stubEnv('P2P_TURN_TTL_SECONDS', ttl);

    expect(new IceServersService().forInstance('i')[1]?.username).toBe('86400:i');
  });

  it('should leave TURN out without a secret', () => {
    vi.stubEnv('P2P_TURN_URLS', 'turn:t.test:3478');

    expect(new IceServersService().forInstance('i')).toHaveLength(1);
  });
});
