---
name: orchestrator
description: >
  Orquestração agnóstica a canais para agentes de IA: turnos, delegação do CEO com
  as tags <delegate>/<attachment>/<agent_result>, delegação paralela, perguntas diretas de qualquer agente
  ao usuário (<question>/<user_answers>, fila de perguntas por conversa), retomada de sessão ACP persistida por papel e projeto (agentSessions,
  e agente, DATA_DIR), seleção de agente/modelo/effort por conversa, troca do agente do CEO,
  rodapé com TurnResult.agentInfo,
  cancelamento, fila por conversa e ISessionStorePort. Use ao implementar turnos,
  delegação, cancelamento, persistência de sessões e configurações, seleção de modelo
  ou novas interfaces de canal.
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

Representa o vínculo durável entre a origem conversacional e o ambiente de trabalho. Contém
apenas dados serializáveis; o estado de execução (agentes vivos, fila, turno ativo) pertence ao
`ConversationRuntimeService`:

- `sessionId`: identificador único da sessão (UUID v4 ou string estável);
- `conversationId`: identificador único da conversa (gerado pelo canal ou cliente);
- `userId`: identificador do usuário autor da sessão;
- `workspacePath`: caminho absoluto do diretório de trabalho do projeto;
- `agentRole`: papel raiz da conversa (ex.: `'CEO'`);
- `agentSessions`: lista de `AgentSession` (`agent-session.model.ts`: `role`, `agentId`, `sessionId`, `projectName`) com a sessão ACP de cada papel (CEO e delegados) em cada agente e projeto, no máximo uma por papel/agente/projeto, usada para retomá-las com `loadSession`. `projectName` é `null` para quem roda na raiz de workspaces (o CEO e delegações sem pasta); por ser parte da chave, o histórico de um papel num projeto nunca é retomado em outro. O `JsonSessionStoreAdapter` carrega entradas gravadas sem `projectName` como `null`. Voltar a um agente já usado na conversa retoma a sessão dele. Uma sessão nova começa com a lista vazia;
- `createdAt` e `updatedAt`: marcos temporais de ciclo de vida.

### `TurnRequest` (`turn-request.model.ts`)

Encapsula os parâmetros para execução de uma rodada de interação:

- `conversationId`: identificador da conversa solicitante;
- `userId`: autor do prompt;
- `prompt`: instrução enviada pelo usuário;
- `workspacePath`: diretório local de trabalho associado ao turno;
- `agentRole`: papel raiz que recebe o prompt (ex.: `'CEO'`);
- `attachments`: lista opcional de `TurnAttachment` (`turn-attachment.model.ts`: `name`, `path`, `contentType`, `size`, `url?`) com arquivos recebidos e baixados localmente;
- `onActivity`: callback opcional `(activity: AgentActivity) => void` para consumo reativo de pensamentos e ferramentas;
- `onTextChunk`: callback opcional `(chunk: string) => void` para streaming progressivo da resposta;
- `onQueued`: callback opcional `() => void` chamado quando o turno entra na fila atrás de outro turno da mesma conversa.
- `onInterimMessage`: callback opcional `(message: string) => void`, chamado com a `message` de uma resposta do CEO que delega, quando não vazia, antes de as delegações começarem.
- `onQuestion`: callback opcional `(prompt: QuestionPrompt) => void`, chamado quando um agente deste turno pergunta e a pergunta chega à frente da fila da conversa por conta própria (ver "Perguntas ao Usuário").
- `onDelegation`: callback opcional `(event: DelegationEvent) => void` (`delegation-event.model.ts`), chamado com `phase: 'started'` antes de o delegado trabalhar e `phase: 'finished'` quando ele conclui com sucesso; carrega `round`, `role`, `roleName` e `projectName?`. O `finished` traz também `response`, `agentInfo` e `usage` do delegado e `durationMs`.

### `ActiveTurn` (`active-turn.model.ts`)

Representa o turno em execução de uma conversa:

- `activate(agentPort)`: registra o agente que está rodando (CEO ou delegado);
- `cancel()`: marca o turno como cancelado e chama `cancel()` no agente ativo;
- `reset()`: redefine o estado de cancelamento para falso;
- `throwIfCancelled()`: lança `PromptCancelledError` se o turno foi cancelado. O orquestrador o chama antes de `connect`, depois de `connect` e antes de cada `prompt`, para que um cancelamento pedido enquanto o agente ainda conecta interrompa o turno.

### `ActiveDelegation` (`active-delegation.model.ts`)

Representa uma delegação técnica atualmente em andamento em segundo plano:

- `role`: papel do agente delegado;
- `roleName`: nome legível do papel;
- `projectName`: projeto/diretório alvo da tarefa ou `null`;
- `taskSpec`: especificação corrente da tarefa delegada;
- `cwd`: diretório de trabalho do delegado;
- `startedAt`: timestamp de início;
- `agentPort`: instância `IAgentPort` do agente delegado;
- `turn`: instância `ActiveTurn` associada à execução do delegado;
- `steer(newSpec)`: redireciona a execução da tarefa via steering nativo ACP.

### `TurnResult` (`turn-result.model.ts`)

Estrutura imutável com o desfecho do turno:

- `sessionId`: identificador da sessão processada; ausente quando o turno falha antes de abrir a sessão;
- `response`: resposta textual final consolidada;
- `status`: `'completed'` em caso de sucesso, `'cancelled'` se interrompido, `'failed'` se abortado por erro, ou `'steered'` quando o prompt foi injetado na rodada do CEO já em andamento (a resposta dele vem no resultado daquele turno, então `response` fica vazio e não há `usage`);
- `usage`: consumo de tokens da última rodada do CEO (`getLastRoundUsage()`); ausente quando o agente não informa ou a coleta falha;
- `errorMessage`: mensagem de erro presente exclusivamente em desfechos com falha;
- `agentInfo`: `TurnAgentInfo` (`roleName`, `agentName`, `modelName?`, `effortName?`), preenchido nos três status para o canal exibir com qual agente, modelo e effort a resposta foi gerada;
- `attachments`: lista opcional de caminhos absolutos dos `<attachment>` da resposta final, resolvidos por `resolveAttachmentPaths` (`utils/attachment-path.util.ts`): caminhos relativos partem de `workspacePath`, o prefixo `file://` é aceito, e só arquivos regulares existentes entram, sem duplicatas.

### `AgentSettings` (`agent-settings.model.ts`)

Configuração de agente, modelo e effort de uma conversa: `agentId`, `agentName` (nome de exibição do
catálogo), `modelId`, `modelName`, `effortId`, `effortName` e `updatedAt`. `modelId === null`
indica agente sem modelos publicados; `effortId === null`, modelo sem níveis de effort.

### `AgentConfigSelection` (`agent-config-selection.model.ts`)

Estado da seleção em andamento numa conversa: `conversationId`, `step`
(`'agent' | 'model' | 'effort'`), `options` numeradas (`SelectionOption`: `index`, `id`, `label`,
`description?`), `selectedAgent?` (presente nas etapas `model` e `effort`), `selectedModel?`
(presente na etapa `effort`) e `pendingPrompt?`. Os desfechos dos use cases de seleção
estão em `agent-config-outcome.model.ts`.

## Portas do Orquestrador

As portas do orquestrador residem em `src/modules/orchestrator/ports/`:

### 1. `ISessionStorePort` (`session-store.port.ts`)

Responsável pela persistência e consulta do estado das sessões:

- `findSession(conversationId: string): Promise<SessionContext | null>`
- `saveSession(session: SessionContext): Promise<void>`
- Symbol homônimo: `export const ISessionStorePort = Symbol('ISessionStorePort');`

A implementação é o `JsonSessionStoreAdapter`, que grava `DATA_DIR/sessions.json`. Os specs
usam o `InMemorySessionStoreFake` de `testing/`.

### `IAgentSettingsStorePort` (`agent-settings-store.port.ts`)

`load(conversationId: string): Promise<AgentSettings | null>`, `loadMostRecent(): Promise<AgentSettings | null>` e
`save(conversationId: string, settings: AgentSettings): Promise<void>`. Cada conversa
tem a própria configuração: `/agent` e `/model` alteram só a conversa (`conversationId`) em que rodam.
`loadMostRecent()` devolve a configuração mais recente (maior `updatedAt`), permitindo herança automática para novas conversas.
Implementado por `JsonAgentSettingsStoreAdapter` em `DATA_DIR/agent-settings.json`, um mapa `conversationId` → `AgentSettings`.

### `IAgentConfigSelectionStorePort` (`agent-config-selection-store.port.ts`)

`find(conversationId: string)`, `save(selection: AgentConfigSelection)` e `remove(conversationId: string): Promise<boolean>`. Implementado em memória por
`InMemoryAgentConfigSelectionStoreAdapter`: uma seleção interrompida por reinício é descartada.

### Persistência em `DATA_DIR`

`resolveDataDirectory()` (`utils/data-directory.util.ts`) resolve, nesta ordem, o diretório
passado ao construtor, `process.env.DATA_DIR` e `./data`. Os adapters JSON carregam o arquivo
uma única vez, mantêm o conteúdo em memória, tratam arquivo ausente ou inválido como vazio e
serializam as escritas. O `JsonSessionStoreAdapter` carrega registro sem `agentSessions` com a lista vazia.
Settings sem `agentId` são tratadas como ausentes, o que reabre a seleção na próxima mensagem, e
entradas de `agentSessions` sem `agentId` são descartadas na leitura.

### 2. `IAgentRegistryPort` (`agent-registry.port.ts`)

Contrato para resolução de instruções comportamentais e especificações de modelo:

- `getSystemPrompt(agentRole: string): string`
- `getDefaultModel(agentRole: string): string | undefined`
- `getDefaultSessionMode(agentRole: string): 'resume' | 'new'`
- `getDisplayName(agentRole: string): string`: nome exibido no rodapé (o próprio papel quando desconhecido)
- `hasRole(agentRole: string): boolean`: valida o papel de uma delegação
- `getDelegationContract(agentRole: string): DelegationContract`: atributos de `<delegate>` que o papel aceita (`project`, `sessionMode`); contrato vazio para papel desconhecido
- `getTurnReminder(agentRole: string): string`: lembrete injetado ao final de cada prompt do turno (sempre string, vazia quando o papel não tem)
- `isSystemPromptEveryTurn(agentRole: string): boolean`: papel cujo system prompt acompanha toda mensagem do usuário (o CEO)
- `getWorkspaceFiles(workspaceDir: string): readonly WorkspaceFile[]`: arquivos de orientação (`workspace-file.model.ts`: `path` relativo à raiz de workspaces, `content`) gravados no boot
- Symbol homônimo: `export const IAgentRegistryPort = Symbol('IAgentRegistryPort');`

A implementação é o `AgentRegistryService` do `AgentDefinitionsModule`, que resolve os
prompts completos de cada papel (`CEO`, `TECH_LEAD`, `DEVELOPER`, `CODE_REVIEWER`), fornece lembretes de turno e devolve um prompt genérico para
papéis desconhecidos.

### 3. `ConversationRuntimeService` (`services/conversation-runtime.service.ts`)

Mantém em memória o estado de execução de cada conversa, identificada por
`buildConversationKey(channelId, threadId)` (`utils/conversation-key.util.ts`, formato
`channelId:threadId`). A chave é a conversa e não o `sessionId` porque a sessão só é resolvida
dentro da fila:

- **Agente da conversa**: um `IAgentPort` do CEO criado com `IAgentPortFactory.create(agentId)` na primeira execução e reutilizado enquanto `agentName === agentId`. Quando o turno pede outro agente, a porta anterior recebe `closeSession()` e `disconnect()` (falhas ignoradas) e uma nova é criada. A troca acontece dentro da fila do CEO, depois dos turnos que ainda usam a porta anterior. `getCeoPort(conversationKey)` devolve a porta atual ou `undefined` antes da primeira execução;
- **Ciclo de vida e concorrência**: `beginTurn(conversationKey)` rastreia `activeTurnsCount` e previne expiração prematura; `runOnCeo(conversationKey, agentId, work, onQueued)` garante exclusão mútua apenas no uso da porta do CEO, liberando-a enquanto agentes delegados rodam em segundo plano;
- **Fila de turnos do CEO**: turnos que chegam enquanto o CEO está ocupado chamam `onQueued` e aguardam a liberação da porta do CEO, exceto quando entram na rodada por steering. Novas mensagens do usuário processam imediatamente pelo CEO mesmo com delegações ativas;
- **Steering do CEO**: `steerCeo(conversationKey, agentId, text)` injeta o texto na rodada do CEO em andamento com `sendSteeringPrompt` e devolve se foi entregue. Só tenta quando há turno ativo não cancelado, nenhum outro turno na fila (`pendingTurns === 1`, para não passar à frente de uma mensagem anterior), a porta do CEO é do `agentId` pedido e anuncia `supportsSteering` (lido do `initialize` do ACP);
- **Delegações ativas**: `registerDelegation(conversationKey, delegation)`, `unregisterDelegation(conversationKey, delegation)`, `getActiveDelegations()` e `findActiveDelegation(conversationKey, role, projectName)` mantêm o registro de especialistas em execução em segundo plano, indexado por papel e projeto: o mesmo papel roda em paralelo em projetos diferentes. `unregisterDelegation` ignora uma delegação que já foi substituída por outra mais nova do mesmo papel e projeto;
- **Cancelamento**: `cancel(conversationKey)` cancela o `ActiveTurn` do CEO e todas as `activeDelegations` ativas da conversa. Devolve `false` quando não há trabalho em andamento;
- **Expiração por ociosidade**: sem turnos e sem delegações por `SESSION_IDLE_TIMEOUT_MS` (padrão 30 minutos), encerra todos os agentes (`closeSession` + `disconnect`). A `SessionContext` e suas `agentSessions` permanecem no store, e a mensagem seguinte retoma a sessão ACP com `loadSession`;
- **Shutdown**: `onApplicationShutdown` desconecta todos os agentes (CEO e delegados). Requer `app.enableShutdownHooks()` no bootstrap.

### 4. `DelegationDetectorService` (`services/delegation-detector.service.ts`)

Interpreta as tags de protocolo da resposta do CEO e devolve uma `CeoDecision`. Reconhece
`<delegate>` e `<attachment>`, com nome e atributos em qualquer caixa e valores entre aspas
duplas ou simples, e entrega o texto restante ao `QuestionParserService` para reconhecer
`<question>`; qualquer outra tag fica no texto. A leitura de atributos e corpo de tag vem de
`utils/protocol-tag.util.ts`, compartilhado pelos dois parsers. O texto fora das tags, com linhas
em branco repetidas colapsadas, é a `message` dirigida ao usuário:

- `{ kind: 'delegate', message, delegations: [{ delegateToRole, projectName, taskSpec, sessionMode? }] }` quando há ao menos um `<delegate role="ROLE" project="pasta" session="new|resume">tarefa</delegate>`. `role` é obrigatório e normalizado para maiúsculas, `project` e `session` são opcionais, e `taskSpec` é o conteúdo da tag sem os espaços das bordas, preservando markdown e `<`/`>` soltos. Só o conteúdo da tag chega ao agente;
- `{ kind: 'ask', message, questions }` quando há `<question>`: perguntas ao usuário, cujas respostas voltam ao CEO no mesmo turno;
- `{ kind: 'reply', message, attachments }` quando não há `<delegate>` nem `<question>`: a resposta ao usuário, que encerra o turno. `attachments` lista o atributo `path` de cada `<attachment path="...">descrição</attachment>` ou `<attachment path="..." />`, na ordem em que aparecem;
- `{ kind: 'invalid', reason }` para tag de fechamento sem abertura; `<delegate>` ou `<attachment>` sem fechamento ou com outra de mesmo nome dentro; atributo desconhecido ou sem aspas; `<delegate>` sem `role` válido, com `project` vazio, `session` diferente de `new`/`resume` ou sem tarefa; `<attachment>` sem `path`; anexos numa resposta que delega; `<question>` malformada; e perguntas junto com `<delegate>` ou com `<attachment>`. `reason` é escrito em inglês para o CEO corrigir a resposta.

## Casos de Uso e Ciclo de Vida do Turno

### Hierarquia de Diretórios

O CEO opera na raiz de workspaces (`IWorkspacePort.getBaseDirectory()`, padrão
`./workspaces/` ou `WORKSPACE_DIR`), que o canal envia como `TurnRequest.workspacePath`.
Cada agente delegado opera em `IWorkspacePort.resolveRepositoryPath(project)`:

```text
./workspaces/                    ← cwd do CEO e do GIT_OPS sem pasta de projeto
├── AGENTS.md                    ← manual do CEO, regenerado no boot
├── .agents/skills/              ← skills do CEO, regeneradas no boot
├── .claude/skills -> ../.agents/skills
├── workspace-manifest.json      ← de→para URL/pasta, escrito só pelo GIT_OPS
├── my-backend/                  ← cwd do agente delegado com <delegate role="ROLE" project="my-backend">
└── my-frontend/
```

Antes de cada `createSession(cwd)`, o orquestrador chama `IWorkspacePort.ensureDirectory(cwd)`, pois o
`agy` falha ao iniciar em diretório inexistente. `resolveRepositoryPath` e `ensureDirectory` rejeitam
caminhos fora da raiz de workspaces, já que o nome do projeto vem da resposta do CEO, e
`resolveRepositoryPath` rejeita também caminhos aninhados (`my-app/src`). Uma pasta de projeto
precisa ainda constar em `listProjectFolders()` (subpastas diretas não ocultas, incluindo links para diretórios): um nome errado
viraria um CWD vazio criado pelo `ensureDirectory`, então a delegação vira `invalid` e o reparo
lista as pastas existentes.

`IWorkspacePort` expõe `getBaseDirectory`, `resolveRepositoryPath`, `ensureDirectory`,
`listProjectFolders`, `writeFile` (caminho relativo à raiz, sobrescreve) e `ensureSymlink` (recusa
substituir arquivo ou diretório real): a app resolve, lista e cria diretórios e grava a orientação
do CEO, e não executa Git. Clonar um repositório no workspace, registrá-lo no manifest
e as demais operações avulsas de Git contra um remoto pertencem ao agente `GIT_OPS`, e a URL chega até ele
pela especificação que o CEO escreve. Scripts do próprio projeto que clonam sub-repositórios, como um
`init`, são executados pelo `DEVELOPER`.

### Orientação do CEO no Workspace (`ProvisionWorkspaceGuidanceUseCase`)

No `onModuleInit`, antes de os canais conectarem, grava na raiz de workspaces os arquivos de
`IAgentRegistryPort.getWorkspaceFiles(baseDir)` (o `AGENTS.md` e as skills do CEO), sempre
sobrescrevendo para seguir o código e o registry, e garante o link `.claude/skills` →
`../.agents/skills`. Falha é registrada em log e não derruba o serviço, porque o prompt núcleo
enviado em todo turno mantém o CEO operando. Os agentes delegados rodam numa subpasta e não são
orientados a ler esses arquivos; por isso não se gera `CLAUDE.md`, que o Claude Code carrega dos
diretórios pais e vazaria para eles.

### Protocolo de Tags

| Resposta do CEO | Ação do orquestrador |
|---|---|
| Com `<delegate>` | Entrega a `message` a `onInterimMessage` e, para cada tag, cria novo `IAgentPort` para `ROLE` com `cwd` no projeto, retoma ou inicia sessão conforme `session` / `defaultSessionMode` e envia `taskSpec` (prefixado com `systemPrompt(ROLE)` quando a sessão é criada) |
| Com `<question>` | Enfileira as perguntas e, com as respostas, roda nova rodada do CEO no mesmo turno |
| Sem `<delegate>` nem `<question>` | Encerra o loop e devolve a `message` como `response`, com os anexos resolvidos |
| *(inválida)* | Envia ao CEO o prompt de reparo com o motivo |

A resposta classificada é o conteúdo do envelope `<final_response>`, extraído pelo demux, e por
isso as tags ficam dentro dele. O prompt de reparo reforça essa regra.

O resultado do agente delegado volta ao CEO como `<agent_result role="ROLE" project="pasta">\n<resposta>\n</agent_result>` (sem `project` quando não há pasta). Numa delegação paralela, os resultados chegam juntos, um bloco por delegação, na ordem das tags, separados por linha em branco.

### Execução de Turno (`ExecuteAgentTurnUseCase`)

Injeta `@Inject(IAgentPortFactory)`, `@Inject(ISessionStorePort)`, `@Inject(IAgentRegistryPort)`,
`@Inject(IWorkspacePort)`, `@Inject(IAgentSettingsStorePort)`, `DelegationDetectorService`,
`ConversationRuntimeService`, `QuestionParserService` e `UserQuestionQueueService`.

A execução do método `execute(request: TurnRequest): Promise<TurnResult>` segue a sequência:

1. **Ciclo de vida do Turno**: invoca `ConversationRuntimeService.beginTurn(conversationKey)`, garantindo rastreamento no contador de turnos ativos até o `finally`.
2. **Agente do turno**: lê as `AgentSettings` da conversa; o `agentId` do turno é o delas ou `IAgentPortFactory.defaultAgentId`. O CEO e todos os delegados do turno usam esse agente.
   - **Steering**: antes de entrar na fila, tenta `steerCeo` com `buildCeoSteeringPrompt` (`prompts/ceo-steering.prompt.ts`, bloco `[USER_MESSAGE]` que manda continuar a tarefa atual considerando a mensagem, porque sem isso o modelo tende a responder só a mensagem e encerrar a rodada) sobre o prompt enriquecido com `[ATTACHMENTS]`, seguido do `getTurnReminder(role)`. Entregue, retorna `status: 'steered'` com o `sessionId` salvo e o `agentInfo` do CEO, sem rodar nova rodada. Não entregue (agente sem steering, CEO ainda conectando ou entre rodadas, fila ocupada), segue o fluxo normal.
3. **Exclusão mútua do CEO**: executa a rodada do CEO via `ConversationRuntimeService.runOnCeo(conversationKey, ...)`. A porta do CEO é liberada assim que o CEO decide delegar, permitindo que novas mensagens do usuário sejam atendidas enquanto especialistas trabalham em segundo plano.
4. **Resolução de Sessão e Enriquecimento de Prompt**: resolvida na primeira rodada do CEO dentro de `runOnCeo` para que mensagens simultâneas compartilhem deterministicamente a mesma sessão persistida. Se houver `request.attachments`, enriquece o prompt com o bloco `[ATTACHMENTS]` detalhando o inventário local (nome, tamanho, tipo MIME e caminho absoluto no disco) e orientando o agente a inspecionar os arquivos utilizando as ferramentas disponíveis em seu ambiente. Se houver delegações em andamento (`getActiveDelegations`), injeta o bloco `[ACTIVE_DELEGATIONS]` no prompt inicial do CEO.
5. **Loop de Delegação**: repete até `MAX_DELEGATION_ROUNDS` (10) rodadas:
   1. Executa o turno do CEO com `cwd = request.workspacePath`.
   2. Classifica a resposta com `DelegationDetectorService.detect()` e valida a delegação: o papel precisa existir (`hasRole`) e ser diferente do papel raiz, os atributos da tag precisam caber no `getDelegationContract(role)` e o projeto precisa ser aceito por `resolveRepositoryPath` e constar em `listProjectFolders()`. Falhas de validação viram `invalid`, e as de projeto listam as pastas existentes no motivo. Com várias delegações, valida cada uma e depois o conjunto: o mesmo papel não aparece duas vezes no mesmo projeto, e no máximo um agente que modifica arquivos trabalha em cada `cwd`, contando as delegações ativas de turnos anteriores; agentes com `readOnly` no contrato não contam, e uma delegação ativa do mesmo papel e projeto também não, porque a nova a redireciona.
   3. **Reparo**: em `invalid`, envia ao CEO `buildDelegationRepairPrompt(reason)` (`prompts/delegation-repair.prompt.ts`), iniciado por `[DELEGATION_ERROR]`, e classifica a nova resposta. São até `MAX_REPAIR_ATTEMPTS` (1) tentativas por resposta do CEO, fora da contagem de rodadas. Persistindo `invalid`, retorna `status: 'failed'` com `errorMessage: 'Invalid CEO response: <reason>'`.
   4. `ask` não sai da rodada: o CEO aguarda as respostas na fila e recebe `<user_answers>` na mesma porta, dentro do `runOnCeo`, com `isUserMessage` verdadeiro (o system prompt acompanha); a nova resposta é classificada e reparada como a primeira. `reply` encerra com `status: 'completed'`.
   5. Em `delegate` na última rodada, encerra sem executar o delegado (item 6), porque o resultado não voltaria ao CEO.
   6. Nas demais rodadas, em `delegate`, entrega a `message` não vazia a `onInterimMessage` e executa todas as delegações em paralelo (`Promise.allSettled`), cada uma como abaixo, e só devolve o controle ao CEO quando todas terminam, para nenhum agente seguir rodando sem observação. Se alguma foi cancelada, o turno é cancelado. Uma delegação que falhou por outro erro vira o bloco `<agent_result role="ROLE" project="pasta" status="failed">\n<mensagem>\n</agent_result>` (registrado como `[Delegation Failed]`), e o CEO recebe junto os resultados das demais para decidir entre repetir a tarefa ou avisar o usuário:
      - Quando o papel já possui delegação ativa no mesmo projeto (`findActiveDelegation`):
        - Se o agente não está aguardando respostas na fila, `existing.agentPort.supportsSteering === true` e `await existing.steer(taskSpec)` confirma a entrega: retorna imediatamente o `<agent_result>` com `Steering message sent to active agent.`. Um agente aguardando respostas não tem rodada em andamento para receber o steering.
        - Sem steering, com a entrega recusada ou com o agente aguardando respostas: descarta as perguntas dele da fila (`discard`, que rejeita a espera com cancelamento), cancela a rodada ativa anterior (`await existing.turn.cancel()`), fecha a sessão e desconecta o transporte com tratamento tolerante a erros (`closeSession()`, `disconnect()`), remove do runtime e prossegue para inicializar nova porta no diretório solicitado, retomando a sessão ACP correspondente e aguardando a resposta consolidada do especialista.
      - Cria a porta do delegado com `create(agentId)`, cria `ActiveDelegation` e registra no runtime. O método `steer` atualiza a `taskSpec` e, com `supportsSteering`, devolve o resultado de `sendSteeringPrompt`; sem steering, devolve `false`.
      - Registra `[Delegation Started]` e emite `onDelegation` `started`; ao concluir, registra `[Delegation Finished]` e emite `finished`.
      - Entre o início e a conclusão, cada resposta do delegado passa pelo `QuestionParserService`: com perguntas, aguarda as respostas na fila e as devolve ao mesmo agente, na mesma porta e sessão, até ele responder sem perguntas. Marcação malformada recebe um reparo (`buildQuestionRepairPrompt`, iniciado por `[QUESTION_ERROR]`) por resposta; persistindo, a resposta segue como resultado. Só a resposta final vira `<agent_result>`.
   7. No `finally` da delegação, remove do registro de delegações ativas e encerra o agente delegado (`closeSession()` + `disconnect()`).
   8. O próximo prompt do CEO são os blocos `<agent_result>` de todas as delegações, separados por linha em branco.
6. **Limite de Rodadas**: esgotadas as rodadas, retorna `status: 'failed'` com `errorMessage: 'Max delegation rounds exceeded.'`.

Cada turno de agente (CEO ou delegado) executa internamente:

1. Anexa o `getTurnReminder(role)` do papel ao prompt recebido e, com `isSystemPromptEveryTurn(role)`, prefixa o `getSystemPrompt(role)` na primeira rodada do CEO de cada mensagem do usuário e na rodada que entrega `<user_answers>` ao CEO, inclusive em sessão retomada. As rodadas com `<agent_result>` e os prompts de reparo da mesma mensagem não o repetem, salvo quando a sessão ACP é criada nelas.
2. `turn.activate(agentPort)` e `turn.throwIfCancelled()`.
3. `connect()` seguido de `turn.throwIfCancelled()`.
3. Se `currentSessionId` não estiver definido:
   1. **Com sessão do papel no agente da porta (`agentId === agentPort.agentName`) em `agentSessions` e `sessionMode !== 'new'`**: relê a `SessionContext` do store e chama `loadSession(cwd, sessionId)`. Com sucesso, o system prompt não é reenviado, salvo para papel com `isSystemPromptEveryTurn`. A releitura é necessária porque o objeto do turno não reflete as sessões gravadas pelo CEO e por rodadas anteriores.
   2. **Sem ID, modo `'new'` ou load com falha**: `ensureDirectory(cwd)`, `createSession(cwd)` e prefixo do prompt com `getSystemPrompt(role)`. O system prompt acompanha a criação da sessão ACP, e não a da `SessionContext`, para que uma sessão recriada receba as instruções do papel.
   3. Se o ID da sessão ACP mudou, substitui a entrada do par papel/agente em `agentSessions`, preservando as dos outros agentes, e salva no store.
4. Configuração: com `AgentSettings` do mesmo agente da porta e `modelId` definido, `setConfig({ modelId, effortId: effortId ?? undefined })`; nos demais casos, `setConfig({ modelId })` quando `getDefaultModel(role)` retorna modelo. Settings de outro agente são ignoradas porque os IDs de modelo não valem entre agentes. Vale para o CEO e para os delegados.
5. Registro de `request.onActivity` via `onActivity(...)`, desfeito no `finally`. Atividades de todos os agentes fluem para o mesmo callback.
6. `turn.throwIfCancelled()` e drenagem de `prompt(text)`, despachando blocos `agent_message_chunk` para `request.onTextChunk`.
7. Resposta a partir de `lastAgentMessage` ou dos blocos acumulados, registrada no log como `[Agent Response] Role=<ROLE>, Length=<n>` com prévia de 100 caracteres em linha única.

**Tratamento de Cancelamento e Falhas**: `PromptCancelledError` (ou erro com nome
homônimo) lançado por qualquer agente ou pelo `ActiveTurn` retorna `status: 'cancelled'`. Demais
erros retornam `status: 'failed'` com `errorMessage` e desconectam o agente do CEO, para que o
turno seguinte suba um transporte novo e retome a sessão. Em ambos os casos, `response` recebe
o `lastAgentMessage` da porta do CEO usada no turno (vazio quando o turno falha antes de haver porta).

**Metadados do turno**: `agentInfo.roleName` vem de `getDisplayName(role)` e `agentName` do
`IAgentPort` do CEO (o `agentId` do turno quando ainda não há porta). `modelName` e `effortName`
vêm das `AgentSettings` do mesmo agente; sem elas, `modelName` é o `displayName` de
`getAvailableModels().currentModelId`.

### Perguntas ao Usuário

Qualquer agente, inclusive o CEO, pergunta direto ao usuário quando precisa de uma decisão dele
para seguir, e a resposta não passa pelo CEO. A gramática vai dentro do `<final_response>`:

```text
Entendi assim: ... (texto livre, mostrado antes da primeira pergunta)

<question rationale="por que a resposta importa">Texto da pergunta
<option>Caminho A</option>
<option>Caminho B</option>
</question>
<question>Pergunta aberta, sem opções</question>
```

- **`QuestionParserService`** (`services/question-parser.service.ts`) devolve `none`, `questions`
  (`message` e `UserQuestion[]` com `text`, `rationale?` e `options`) ou `invalid`: `<option>` fora de
  `<question>`, tag sem fechamento ou sem abertura, atributo desconhecido (`<question>` aceita só
  `rationale`; `<option>` nenhum), pergunta sem texto ou opção vazia. Tags dentro de código Markdown
  (bloco cercado por crases triplas ou trecho entre crases) são marcação citada, como um `<option>` de
  HTML, e ficam no texto.
- **`UserQuestionQueueService`** (`services/user-question-queue.service.ts`) mantém em memória uma
  fila de pedidos por conversa, na ordem em que os agentes perguntaram, e expõe uma pergunta por vez.
  Fica em memória porque o agente que pergunta aguarda vivo dentro do turno, e um reinício já derruba
  turnos e delegações. Operações:
  - `ask(conversationKey, asker, message, questions, notify?)`: enfileira e resolve com
    `AnsweredQuestion[]` quando o usuário responder todas; `notify` mostra a primeira pergunta quando o
    pedido chega à frente da fila por conta própria (fila vazia ou pedido da frente descartado);
  - `submit(conversationKey, { text, attachments? })`: número inteiro entre 1 e N escolhe a opção de
    uma pergunta com opções; número fora da faixa ou entrada vazia sem anexos devolve `invalid` e
    repete a pergunta; qualquer outro texto é resposta livre (`kind="other"`); anexos acompanham a
    resposta e sozinhos também respondem. Desfechos: `next` (próxima pergunta do pedido), `answered`
    (resolve a espera do agente e traz a pergunta do próximo pedido, se houver) e `invalid`; sem
    pergunta pendente, `undefined`;
  - `current`, `hasPending` e `isWaiting(conversationKey, role, projectName)`;
  - `cancel(conversationKey)`: esvazia a fila e rejeita todas as esperas com `PromptCancelledError`;
  - `discard(conversationKey, role, projectName)`: tira o pedido de um agente que está sendo
    substituído, rejeitando a espera dele.
- `QuestionPrompt` (`models/user-question.model.ts`) é o que o canal mostra: `asker` (`role`,
  `roleName`, `projectName`), `question`, `number`, `total`, `message?` (só na primeira pergunta) e
  `waitingAskers`.
- **Respostas ao agente**: um bloco que repete o texto de cada pergunta, para resistir à compactação
  do contexto enquanto o usuário responde, com um `<attachment>` por arquivo anexado (baixado pelo
  canal num diretório temporário):

  ```text
  <user_answers>
  <answer question="Texto da pergunta" option="2">Caminho B</answer>
  <answer question="Outra pergunta" kind="other">texto livre
  <attachment path="/tmp/.../tela.png" name="tela.png" type="image/png"/></answer>
  </user_answers>
  ```

- **Estado travado**: enquanto a conversa tem perguntas pendentes, toda mensagem do usuário é
  resposta (`ResolveConversationInputUseCase` consulta a fila antes de tudo) e nada chega ao CEO, nem
  por steering. `/cancel` destrava a conversa (ver abaixo).

### Cancelamento de Turno (`CancelAgentTurnUseCase`)

Injeta `ConversationRuntimeService` e `UserQuestionQueueService`.

O método `execute(conversationId: string): Promise<boolean>` esvazia a fila de perguntas da conversa
(`cancel`), aciona `ConversationRuntimeService.cancel(conversationId)` e devolve se havia turno em
andamento ou pergunta pendente, inclusive num turno que ainda não salvou a sessão. O
`PromptCancelledError` resultante, vindo do agente ou da espera rejeitada, interrompe o loop de
delegação, e a conversa volta ao estado padrão.

## Seleção de Agente, Modelo e Effort

A escolha é por conversa e persistida. `AgentCapabilitiesService` monta as opções numeradas:
`listAgentOptions()` a partir de `IAgentPortFactory.listAgents()`, e `listModelOptions(agentId)` /
`listEffortOptions(agentId, modelId)` numa porta descartável do agente (`create(agentId)` →
`connect()` → leitura → `disconnect()` no `finally`), isolada da porta da conversa. Sem opções,
devolvem lista vazia. `resolveAgent(settings)` devolve o agente das settings ou o padrão da fábrica.

- **`StartAgentConfigSelectionUseCase`** `({ conversationId, pendingPrompt?, step })`: com `step: 'agent'`, lista os agentes e salva a etapa `agent`; com um único agente, pula direto para a etapa `model` dele; sem agentes, `{ kind: 'unavailable' }`. Com `step: 'model'`, lista os modelos do agente atual (`resolveAgent`) e salva a etapa `model` com `selectedAgent`; sem modelos, `unavailable`.
- **`SubmitAgentConfigSelectionUseCase`** `({ conversationId, input })`: aceita só `^\d+$` entre 1 e N; outra entrada retorna `invalid` sem mudar o estado. Na etapa `agent`, avança para `model` com os modelos do agente escolhido, ou salva só o agente se ele não tiver modelos. Na etapa `model`, avança para `effort` se o modelo tiver efforts, senão salva com `effortId: null`. Na etapa `effort`, salva. Etapa `model`/`effort` sem `selectedAgent` lança erro. Ao salvar, remove a seleção e retorna `{ kind: 'configured', settings, pendingPrompt? }`.
- **`ResolveConversationInputUseCase`** `({ conversationId, prompt, attachments? })`: com pergunta pendente na fila, a mensagem é a resposta (`submit` com o texto e os anexos) e o desfecho vira `{ kind: 'question', prompt }` (próxima pergunta), `{ kind: 'invalid_answer', prompt }` ou `{ kind: 'answered', asker, next? }`. Fora disso, `prompt` vazio significa mensagem só com anexos e recebe um prompt que pede a análise deles. Com seleção ativa, delega para `Submit`; sem settings para a conversa, tenta herdar de `loadMostRecent()` (salvando imediatamente para a conversa com `updatedAt` renovado); se não houver histórico, delega para `Start` com `step: 'agent'` e `pendingPrompt` (`unavailable` vira `execute`); com settings, `execute`. Um `configured` com `pendingPrompt` vira `{ kind: 'execute', prompt: pendingPrompt, configured }`.
- **`CancelAgentConfigSelectionUseCase`**: remove a seleção e retorna se havia uma.

Trocar de agente não interrompe turnos em andamento: o turno seguinte da conversa troca a porta do
CEO e os delegados seguintes já nascem no agente novo.

## Fachada de Serviço (`OrchestratorService`)

Interface do orquestrador para os canais:

- `executeTurn(request)` e `cancelTurn(conversationId: string)`;
- `getQuota(conversationId: string)`: `GetAgentQuotaUseCase` resolve o agente salvo na conversa (ou o padrão) e devolve `AgentQuotaReport` (`agent` e `quota`, `undefined` quando o agente não expõe cota), sem abrir sessão;
- `resolveInput({ conversationId, prompt, attachments? })`: decide entre responder a pergunta pendente, conduzir a seleção ou executar o prompt;
- `startConfigSelection(conversationId: string)` (etapa `model` do agente atual), `startAgentSelection(conversationId: string)` (etapa `agent`) e `cancelConfigSelection(conversationId: string)`;
- `hasActiveConfigSelection(conversationId: string)` e `hasPendingQuestions(conversationId: string)`.

## Regras Prescritivas Mandatórias

- **Proibido acoplamento com Discord ou canais de rede**: o orquestrador manipula unicamente identificadores genéricos (`conversationId`, `userId`), sem importar discord.js, HTTP frameworks ou drivers de terceiros.
- **Portas e Symbols**: toda dependência externa aos use cases deve utilizar injeção por Symbol (`@Inject(ISessionStorePort)`).
- **Sem barrel exports**: nunca crie `index.ts` em `models/`, `ports/`, `adapters/`, `services/` ou `use-cases/`.
- **Limpeza de recursos reativos**: todo callback registrado em `onActivity` deve ser desconectado em bloco `finally`.
- **Uma sessão ACP por conversa, papel, agente e projeto**: obtenha instâncias de `IAgentPort` exclusivamente pela `IAgentPortFactory`, sempre com o `agentId` do turno. O agente do CEO de cada conversa vive no `ConversationRuntimeService`, e cada delegação usa uma instância descartável que retoma a sessão ACP do papel naquele projeto.
- **Sessão só com dados**: `SessionContext` guarda apenas dados serializáveis. Agentes vivos, fila e turno ativo ficam no `ConversationRuntimeService`, porque o store é persistido em disco.
- **Controle de concorrência e exclusão mútua do CEO**: todo turno registra seu ciclo de vida em `ConversationRuntimeService.beginTurn(conversationKey)`, e as interações com o CEO passam por `ConversationRuntimeService.runOnCeo(conversationKey, work)`. O CEO fica liberado durante a execução de delegados em segundo plano, mantendo o enfileiramento estrito de chamadas simultâneas na mesma porta do CEO para evitar chamadas paralelas a `prompt()`.
- **Delegação cancelável**: todo agente em execução deve ser registrado com `turn.activate(agentPort)`, e `turn.throwIfCancelled()` deve preceder `connect` e `prompt`.
- **Limite de rodadas**: mantenha `MAX_DELEGATION_ROUNDS` para impedir loops infinitos entre CEO e agentes delegados.
- **Não vazar exceções em execute()**: `ExecuteAgentTurnUseCase.execute()` deve devolver `TurnResult` com `status: 'failed'` ou `status: 'cancelled'`, nunca lançar erros descontrolados para a camada de apresentação.
