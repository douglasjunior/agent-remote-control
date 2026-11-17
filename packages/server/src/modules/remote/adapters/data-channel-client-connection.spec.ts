import { toFrames } from '@agent-remote-control/protocol/data-channel-frames';
import { Logger } from '@nestjs/common';

import { FakeRemoteChannel } from '../testing/fake-remote-peer.js';

import { DataChannelClientConnection } from './data-channel-client-connection.js';


describe('DataChannelClientConnection', () => {
  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('should send each event in frames', () => {
    const channel = new FakeRemoteChannel();
    new DataChannelClientConnection(channel).send({ type: 'auth.ok' });

    expect(channel.sent).toEqual(['0/1\n{"type":"auth.ok"}']);
  });

  it('should deliver whole messages as JSON or raw text until unsubscribed', () => {
    const channel = new FakeRemoteChannel();
    const connection = new DataChannelClientConnection(channel);
    const received: unknown[] = [];
    const unsubscribe = connection.onMessage(data => received.push(data));

    toFrames(JSON.stringify({ type: 'auth', token: 'x'.repeat(40_000) })).forEach(frame => channel.receive(frame));
    toFrames('not json').forEach(frame => channel.receive(frame));
    unsubscribe();
    channel.receive('0/1\n{}');

    expect(received).toEqual([{ type: 'auth', token: 'x'.repeat(40_000) }, 'not json']);
  });

  it('should close the channel on a malformed frame', () => {
    const warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const channel = new FakeRemoteChannel();
    new DataChannelClientConnection(channel).onMessage(() => undefined);

    channel.receive('no header');

    expect(channel.closed).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reason=a frame without a header'));
  });

  it('should report the close of the channel and close it', () => {
    const channel = new FakeRemoteChannel();
    const connection = new DataChannelClientConnection(channel);
    const closed = rs.fn();
    connection.onClose(closed);

    channel.emitClose();
    connection.close();

    expect(closed).toHaveBeenCalledOnce();
    expect(channel.closed).toBe(true);
  });
});
