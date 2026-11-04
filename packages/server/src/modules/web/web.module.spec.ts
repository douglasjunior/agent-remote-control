import { Test } from '@nestjs/testing';

import { WsClientTransportAdapter } from './adapters/ws-client-transport.adapter.js';
import { WebConnectionHandler } from './handlers/web-connection.handler.js';
import { IClientTransportPort } from './ports/client-transport.port.js';
import { WebModule } from './web.module.js';


describe('WebModule', () => {
  it('binds the transport port to the WebSocket adapter and resolves the handler', async () => {
    const module = await Test.createTestingModule({ imports: [WebModule] }).compile();

    expect(module.get(IClientTransportPort)).toBeInstanceOf(WsClientTransportAdapter);
    expect(module.get(WebConnectionHandler)).toBeInstanceOf(WebConnectionHandler);
  });
});
