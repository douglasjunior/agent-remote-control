import { useTemporaryDataDir } from '../../../test/temporary-data-dir.js';
import { createTestingModule } from '../../../test/testing-module.js';

import { NodeDataChannelPeerAdapter } from './adapters/node-datachannel-peer.adapter.js';
import { RemoteClientTransportAdapter } from './adapters/remote-client-transport.adapter.js';
import { WsSignalingClientAdapter } from './adapters/ws-signaling-client.adapter.js';
import { IRemotePeerFactoryPort } from './ports/remote-peer.port.js';
import { ISignalingClientPort } from './ports/signaling-client.port.js';
import { RemoteModule } from './remote.module.js';


describe('RemoteModule', () => {
  useTemporaryDataDir();

  it('should bind the ports to their adapters and resolve the transport', async () => {
    const module = await createTestingModule({ imports: [RemoteModule] }).compile();

    expect(module.get(IRemotePeerFactoryPort)).toBeInstanceOf(NodeDataChannelPeerAdapter);
    expect(module.get(ISignalingClientPort)).toBeInstanceOf(WsSignalingClientAdapter);
    expect(module.get(RemoteClientTransportAdapter)).toBeInstanceOf(RemoteClientTransportAdapter);
    await module.close();
  });
});
