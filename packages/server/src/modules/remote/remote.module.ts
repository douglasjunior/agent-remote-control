import { Module } from '@nestjs/common';

import { AccessTokenModule } from '../access-token/access-token.module.js';
import { PathsModule } from '../paths/paths.module.js';
import { StorageModule } from '../storage/storage.module.js';

import { NodeDataChannelPeerAdapter } from './adapters/node-datachannel-peer.adapter.js';
import { RemoteClientTransportAdapter } from './adapters/remote-client-transport.adapter.js';
import { WsSignalingClientAdapter } from './adapters/ws-signaling-client.adapter.js';
import { IRemotePeerFactoryPort } from './ports/remote-peer.port.js';
import { ISignalingClientPort } from './ports/signaling-client.port.js';
import { RemoteIdentityService } from './services/remote-identity.service.js';


@Module({
  imports: [AccessTokenModule, PathsModule, StorageModule],
  providers: [
    { provide: IRemotePeerFactoryPort, useClass: NodeDataChannelPeerAdapter },
    { provide: ISignalingClientPort, useClass: WsSignalingClientAdapter },
    RemoteIdentityService,
    RemoteClientTransportAdapter,
  ],
  exports: [RemoteClientTransportAdapter, RemoteIdentityService],
})
export class RemoteModule {}
