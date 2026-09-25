---
name: orchestrator
description: >
  Padrão de orquestração agnóstico a canais para controle de agentes de IA.
  Governa o ciclo de vida de turnos (ExecuteAgentTurnUseCase, CancelAgentTurnUseCase),
  o loop de delegação do CEO com marcadores [DELEGATE]/[DONE]/[AGENT_RESULT],
  sessões ACP isoladas por conversa via IAgentPortFactory, estruturas TurnRequest e
  TurnResult, armazenamento de contexto com ISessionStorePort, resolução de persona com
  IAgentRegistryPort e streaming reativo. Use ao implementar fluxos de turnos,
  delegação entre agentes, cancelamento, novas interfaces de canal ou persistência de sessões.
---

# Orquestrador de Agentes Agnóstico a Canais

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar qualquer regra descrita aqui. O critério não
> é qual regra — é a natureza da mudança: uma diretriz ou convenção do orquestrador
> mudou → atualize; refator técnico que preserva o padrão descrito → não toque.

O módulo `OrchestratorModule` reside em `src/modules/orchestrator/` e centraliza
toda a coordenação de turnos entre clientes de entrada (canais de chat como Discord,
APIs HTTP ou tarefas agendadas) e os adaptadores de agentes de desenvolvimento.

O orquestrador é completamente desacoplado da tecnologia de apresentação dos canais.
Ele recebe requisições padronizadas, mantém o estado conversacional, cria uma sessão
ACP própria para cada conversa, coordena a delegação do CEO para agentes especialistas
e repassa fluxos de atividade e texto sob demanda.

## Modelos Centrais

Os modelos residem em `src/modules/orchestrator/models/`:

### `SessionContext` (`session-context.model.ts`)

Representa o vínculo durável entre a origem conversacional e o ambiente de trabalho:

- `sessionId`: identificador único da sessão (UUID v4 ou string estável);
- `channelId`: identificador do canal de origem (ex.: canal do Discord ou identificador de sala);
- `threadId`: identificador opcional da subtarefa ou thread aninhada;
- `userId`: identificador do usuário autor da sessão;
- `workspacePath`: caminho absoluto do diretório de trabalho do projeto;
- `agentRole`: papel raiz da conversa (ex.: `'CEO'`);
- `agentPort`: instância de `IAgentPort` exclusiva da conversa, criada pela `IAgentPortFactory` no primeiro turno e reutilizada nos seguintes;
- `activeAgentPort`: instância do agente em execução no momento. Aponta para `agentPort` e, durante uma delegação, para o agente delegado. É o alvo do cancelamento;
- `createdAt` e `updatedAt`: marcos temporais de ciclo de vida.

### `TurnRequest` (`turn-request.model.ts`)

Encapsula os parâmetros para execução de uma rodada de interação:

- `channelId`: canal solicitante;
- `threadId`: identificador opcional da thread;
- `userId`: autor do prompt;
- `prompt`: instrução enviada pelo usuário;
- `workspacePath`: diretório local de trabalho associado ao turno;
- `agentRole`: papel raiz que recebe o prompt (ex.: `'CEO'`);
- `onActivity`: callback opcional `(activity: AgentActivity) => void` para consumo reativo de pensamentos e ferramentas;
- `onTextChunk`: callback opcional `(chunk: string) => void` para streaming progressivo da resposta.

### `TurnResult` (`turn-result.model.ts`)

Estrutura imutável com o desfecho do turno:

- `sessionId`: identificador da sessão processada;
- `response`: resposta textual final consolidada;
- `status`: `'completed'` em caso de sucesso, `'cancelled'` se interrompido, ou `'failed'` se abortado por erro;
- `usage`: dados opcionais de consumo de tokens (`AgentUsage`);
- `errorMessage`: mensagem de erro presente exclusivamente em desfechos com falha.

## Portas do Orquestrador

As portas do orquestrador residem em `src/modules/orchestrator/ports/`:

### 1. `ISessionStorePort` (`session-store.port.ts`)

Responsável pela persistência e consulta do estado das sessões:

- `findSession(channelId: string, threadId?: string): Promise<SessionContext | null>`
- `saveSession(session: SessionContext): Promise<void>`
- `removeSession(sessionId: string): Promise<void>`
- Symbol homônimo: `export const ISessionStorePort = Symbol('ISessionStorePort');`

A implementação em memória padrão é fornecida por `InMemorySessionStoreAdapter`.

### 2. `IAgentRegistryPort` (`agent-registry.port.ts`)

Contrato para resolução de instruções comportamentais e especificações de modelo:

- `getSystemPrompt(agentRole: string): string`
- `getDefaultModel(agentRole: string): string | undefined`
- Symbol homônimo: `export const IAgentRegistryPort = Symbol('IAgentRegistryPort');`

A implementação é o `AgentRegistryService` do `AgentDefinitionsModule`, que resolve os
prompts completos de cada papel (`CEO`, `DEVELOPER`) e devolve um prompt genérico para
papéis desconhecidos.

### 3. `DelegationDetectorService` (`services/delegation-detector.service.ts`)

Interpreta o final da resposta do CEO e devolve uma `CeoDecision`:

- `{ kind: 'delegate', delegation: { delegateToRole, projectName, taskSpec } }` quando a resposta termina com `[DELEGATE:ROLE:project]` (o segmento `:project` é opcional). `taskSpec` é o texto anterior ao marcador;
- `{ kind: 'done', summary }` quando a resposta termina com `[DONE]`. `summary` é o texto anterior ao marcador;
- `{ kind: 'direct_response' }` quando não há marcador final.

Marcadores no meio do texto são ignorados: apenas o sufixo da resposta decide.

## Casos de Uso e Ciclo de Vida do Turno

### Hierarquia de Diretórios

O CEO opera na raiz de workspaces (`IWorkspacePort.getBaseDirectory()`, padrão
`./workspaces/` ou `WORKSPACE_DIR`), que o canal envia como `TurnRequest.workspacePath`.
Cada agente delegado opera em `IWorkspacePort.resolveRepositoryPath(project)`:

```text
./workspaces/                    ← cwd do CEO
├── workspace-manifest.json
├── my-backend/                  ← cwd do agente delegado com [DELEGATE:ROLE:my-backend]
└── my-frontend/
```

Antes de cada `createSession(cwd)`, o orquestrador chama `IWorkspacePort.ensureDirectory(cwd)`, pois o
`agy` falha ao iniciar em diretório inexistente. `resolveRepositoryPath` e `ensureDirectory` rejeitam
caminhos fora da raiz de workspaces, já que o nome do projeto vem da resposta do CEO. Clonar o
repositório dentro da pasta do projeto é responsabilidade do agente delegado.

### Protocolo de Marcadores

| Marcador no fim da resposta do CEO | Ação do orquestrador |
|---|---|
| `[DELEGATE:ROLE:project]` | Cria novo `IAgentPort` para `ROLE` com `cwd` no projeto e envia `systemPrompt(ROLE) + taskSpec` |
| `[DONE]` | Encerra o loop e devolve o texto anterior ao marcador |
| *(nenhum)* | Encerra o loop e devolve a resposta integral do CEO |

O resultado do agente delegado volta ao CEO como `[AGENT_RESULT:ROLE]\n<resposta>`.

### Execução de Turno (`ExecuteAgentTurnUseCase`)

Injeta `@Inject(IAgentPortFactory)`, `@Inject(ISessionStorePort)`,
`@Inject(IAgentRegistryPort)`, `@Inject(IWorkspacePort)` e `DelegationDetectorService`.

A execução do método `execute(request: TurnRequest): Promise<TurnResult>` segue a sequência:

1. **Resolução de Sessão**: consulta `ISessionStorePort.findSession(channelId, threadId)`. Se inexistente, gera nova `SessionContext` com `agentPort` recém-criado pela fábrica, também atribuído a `activeAgentPort`. Se existente, atualiza `updatedAt` e restaura `activeAgentPort` para `agentPort`. Salva no store.
2. **Prompt do CEO**: no primeiro turno da sessão (`isFirstTurn`), prefixa o prompt com `getSystemPrompt(agentRole)`. Nos turnos seguintes, envia o prompt puro, pois a sessão ACP preserva o histórico.
3. **Loop de Delegação**: repete até `MAX_DELEGATION_ROUNDS` (10) rodadas:
   1. Executa o turno do CEO no `agentPort` da sessão com `cwd = request.workspacePath`.
   2. Classifica a resposta com `DelegationDetectorService.detect()`. `direct_response` e `done` encerram com `status: 'completed'`.
   3. Em `delegate`, cria novo `IAgentPort` pela fábrica, salva a sessão com `activeAgentPort` apontando para ele e executa o turno com `systemPrompt(ROLE) + taskSpec` no diretório do projeto (ou em `request.workspacePath` sem projeto).
   4. No `finally`, salva a sessão com `activeAgentPort` de volta ao `agentPort` e executa `closeSession()` e `disconnect()` no agente delegado, ignorando falhas de encerramento.
   5. O próximo prompt do CEO passa a ser `[AGENT_RESULT:ROLE]\n<resposta do delegado>`.
4. **Limite de Rodadas**: esgotadas as rodadas, retorna `status: 'failed'` com `errorMessage: 'Max delegation rounds exceeded.'`.

Cada turno de agente (CEO ou delegado) executa internamente:

1. `connect()` e, se `currentSessionId` não estiver definido, `ensureDirectory(cwd)` seguido de `createSession(cwd)`.
2. `setConfig({ modelId })` quando `getDefaultModel(role)` retorna modelo.
3. Registro de `request.onActivity` via `onActivity(...)`, desfeito no `finally`. Atividades de todos os agentes fluem para o mesmo callback.
4. Drenagem de `prompt(text)`, despachando blocos `agent_message_chunk` para `request.onTextChunk`.
5. Resposta a partir de `lastAgentMessage` ou dos blocos acumulados.

**Tratamento de Cancelamento e Falhas**: `PromptCancelledError` (ou erro com nome
homônimo) lançado por qualquer agente retorna `status: 'cancelled'`. Demais erros retornam
`status: 'failed'` com `errorMessage`. Em ambos os casos, `response` recebe o
`lastAgentMessage` do CEO.

### Cancelamento de Turno (`CancelAgentTurnUseCase`)

Injeta apenas `@Inject(ISessionStorePort)`.

O método `execute(channelId: string, threadId?: string): Promise<void>`:

1. Localiza a sessão via `ISessionStorePort.findSession(channelId, threadId)`.
2. Sem sessão, registra aviso e encerra sem ação.
3. Com sessão, aciona `activeAgentPort.cancel()`. O `PromptCancelledError` resultante interrompe o loop de delegação.

## Fachada de Serviço (`OrchestratorService`)

Encapsula os casos de uso de execução e cancelamento em uma interface simplificada:

```typescript
@Injectable()
export class OrchestratorService {
  constructor(
    private readonly executeAgentTurnUseCase: ExecuteAgentTurnUseCase,
    private readonly cancelAgentTurnUseCase: CancelAgentTurnUseCase,
  ) {}

  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    return this.executeAgentTurnUseCase.execute(request);
  }

  async cancelTurn(channelId: string, threadId?: string): Promise<void> {
    return this.cancelAgentTurnUseCase.execute(channelId, threadId);
  }
}
```

## Regras Prescritivas Mandatórias

- **Proibido acoplamento com Discord ou canais de rede**: o orquestrador manipula unicamente identificadores (`channelId`, `userId`, `threadId`), sem importar discord.js, HTTP frameworks ou drivers de terceiros.
- **Portas e Symbols**: toda dependência externa aos use cases deve utilizar injeção por Symbol (`@Inject(ISessionStorePort)`).
- **Sem barrel exports**: nunca crie `index.ts` em `models/`, `ports/`, `adapters/`, `services/` ou `use-cases/`.
- **Limpeza de recursos reativos**: todo callback registrado em `onActivity` deve ser desconectado em bloco `finally`.
- **Uma sessão ACP por conversa**: obtenha instâncias de `IAgentPort` exclusivamente pela `IAgentPortFactory`. Cada `SessionContext` carrega seu próprio `agentPort`, e cada delegação usa uma instância descartável.
- **Delegação cancelável**: todo agente delegado em execução deve estar registrado em `activeAgentPort` na sessão salva, para que `/cancel` o alcance.
- **Campos de sessão obrigatórios**: `agentRole`, `agentPort` e `activeAgentPort` existem desde a criação da sessão. Somente `threadId` é opcional, pois conversas privadas não têm thread.
- **Limite de rodadas**: mantenha `MAX_DELEGATION_ROUNDS` para impedir loops infinitos entre CEO e agentes delegados.
- **Não vazar exceções em execute()**: `ExecuteAgentTurnUseCase.execute()` deve devolver `TurnResult` com `status: 'failed'` ou `status: 'cancelled'`, nunca lançar erros descontrolados para a camada de apresentação.
