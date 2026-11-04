import { Module } from '@nestjs/common';

import { WsClientTransportAdapter } from './adapters/ws-client-transport.adapter.js';
import { WebConnectionHandler } from './handlers/web-connection.handler.js';
import { IClientTransportPort } from './ports/client-transport.port.js';
import { WebAccessTokenService } from './services/web-access-token.service.js';
import { WebConnectionRegistryService } from './services/web-connection-registry.service.js';


@Module({
  providers: [
    { provide: IClientTransportPort, useClass: WsClientTransportAdapter },
    WebAccessTokenService,
    WebConnectionRegistryService,
    WebConnectionHandler,
  ],
  exports: [WebConnectionRegistryService],
})
export class WebModule {}
