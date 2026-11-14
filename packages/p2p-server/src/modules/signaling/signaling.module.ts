import { Module } from '@nestjs/common';

import { WsSignalingTransportAdapter } from './adapters/ws-signaling-transport.adapter.js';
import { SignalingConnectionHandler } from './handlers/signaling-connection.handler.js';
import { ISignalingTransportPort } from './ports/signaling-transport.port.js';
import { IceServersService } from './services/ice-servers.service.js';
import { SignalingRegistryService } from './services/signaling-registry.service.js';
import { CloseClientSessionUseCase } from './use-cases/close-client-session.use-case.js';
import { DisconnectHostUseCase } from './use-cases/disconnect-host.use-case.js';
import { OpenClientSessionUseCase } from './use-cases/open-client-session.use-case.js';
import { RegisterHostUseCase } from './use-cases/register-host.use-case.js';
import { RelayClientSignalUseCase } from './use-cases/relay-client-signal.use-case.js';
import { RelayHostSignalUseCase } from './use-cases/relay-host-signal.use-case.js';


@Module({
  providers: [
    { provide: ISignalingTransportPort, useClass: WsSignalingTransportAdapter },
    SignalingRegistryService,
    IceServersService,
    RegisterHostUseCase,
    DisconnectHostUseCase,
    RelayHostSignalUseCase,
    OpenClientSessionUseCase,
    RelayClientSignalUseCase,
    CloseClientSessionUseCase,
    SignalingConnectionHandler,
  ],
})
export class SignalingModule {}
