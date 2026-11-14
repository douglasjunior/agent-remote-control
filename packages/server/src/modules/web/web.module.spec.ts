import { Test } from '@nestjs/testing';

import { CombinedClientTransportAdapter } from './adapters/combined-client-transport.adapter.js';
import { JsonConversationStoreAdapter } from './adapters/json-conversation-store.adapter.js';
import { JsonPromptHistoryAdapter } from './adapters/json-prompt-history.adapter.js';
import { WebConnectionHandler } from './handlers/web-connection.handler.js';
import { IClientTransportPort } from './ports/client-transport.port.js';
import { IConversationStorePort } from './ports/conversation-store.port.js';
import { IPromptHistoryPort } from './ports/prompt-history.port.js';
import { WebModule } from './web.module.js';


describe('WebModule', () => {
  it('should bind the ports to their adapters and resolve the handler', async () => {
    const module = await Test.createTestingModule({ imports: [WebModule] }).compile();

    expect(module.get(IClientTransportPort)).toBeInstanceOf(CombinedClientTransportAdapter);
    expect(module.get(IConversationStorePort)).toBeInstanceOf(JsonConversationStoreAdapter);
    expect(module.get(IPromptHistoryPort)).toBeInstanceOf(JsonPromptHistoryAdapter);
    expect(module.get(WebConnectionHandler)).toBeInstanceOf(WebConnectionHandler);
  });
});
