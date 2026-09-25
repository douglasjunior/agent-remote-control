---
name: agent-port
description: >
  Padrão de integração com agentes de IA via Agent Client Protocol (ACP) e arquitetura
  Ports & Adapters. Define o contrato IAgentPort, ciclo de vida da sessão (connect,
  createSession, prompt, cancel, closeSession), demux de streaming, suporte a steering
  e adaptadores ACP concretos como AntigravityAdapter. Use ao implementar, estender ou
  consumir agentes de IA, bridges ACP, manipulação de processos e demux de streams.
---

# Porta do Agente e Integração ACP

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar qualquer regra descrita aqui. O critério não
> é qual regra — é a natureza da mudança: o protocolo de comunicação, ciclo de vida
> de sessão ou contrato de agente mudou → atualize; ajuste cosmético interno que
> preserva as regras consolidadas → não toque.

## Contrato `IAgentPort`

A porta `IAgentPort` reside em `src/modules/agent/ports/agent.port.ts` e desacopla
o núcleo da aplicação dos detalhes técnicos de comunicação com agentes de IA.

Cada instância de `IAgentPort` representa um subprocesso de agente com uma única sessão
ACP. Consumidores obtêm instâncias pela fábrica `IAgentPortFactory`
(`src/modules/agent/ports/agent-port-factory.port.ts`), registrada no `AgentModule` com
`AntigravityPortFactoryAdapter`:

```ts
@Inject(IAgentPortFactory) private readonly agentPortFactory: IAgentPortFactory

const agentPort = this.agentPortFactory.create();
```

O `AgentModule` exporta apenas a fábrica. Um `IAgentPort` singleton faria todas as
conversas compartilharem a mesma sessão ACP e o mesmo `cwd`.

### Métodos Obrigatórios

- `connect(): Promise<void>`: inicializa o transporte com o agente, executa a descoberta de capacidades e opções de configuração iniciais. É idempotente.
- `createSession(cwd: string): Promise<void>`: cria uma sessão de trabalho vinculada ao diretório informado (`cwd`).
- `prompt(text: string): AsyncGenerator<AgentUpdate>`: envia um turno de instrução ao agente, processando os updates de streaming e gerando blocos consolidados.
- `sendSteeringPrompt(text: string): void`: envia um redirecionamento em tempo real sem interromper o turno atual. Utiliza o protocolo nativo de steering quando suportado, ou prompt direto como fallback.
- `cancel(): Promise<void>`: interrompe o turno corrente através de escada de escalação temporizada.
- `closeSession(): Promise<void>`: encerra a sessão ativa no agente, preservando a conexão base para novas sessões.
- `disconnect(): Promise<void>`: finaliza a conexão de transporte e encerra o subprocesso do agente.
- `getAvailableModels(): AgentModelList | null`: lista os modelos publicados pelo agente e o modelo atualmente ativo.
- `getAvailableEffortsForModel(modelId: string): Promise<AgentEffortList | null>`: inspeciona os níveis de esforço/raciocínio disponíveis para o modelo através de sessão de sondagem isolada.
- `setConfig(config: AgentConfig): Promise<void>`: atualiza o modelo ou nível de raciocínio da sessão ativa.
- `getLastRoundUsage(): Promise<AgentUsage | undefined>`: obtém o consumo de tokens reportado no último turno ou via fallback.
- `getLastAgentMessage(): string | undefined`: retorna a última resposta textual consolidada gerada pelo agente.
- `onActivity(listener: (activity: AgentActivity) => void): () => void`: registra observador para o feed de atividades ao vivo (pensamentos, chamadas de ferramenta e cancelamento).

## Ciclo de Vida da Sessão e Escalação de Cancelamento

A interação com qualquer agente ACP respeita a sequência linear:

```text
connect() ──> createSession(cwd) ──> prompt(text) ──> closeSession() ──> disconnect()
                                       │       ▲
                                       └── cancel()
```

O método `cancel()` aciona uma escada de três degraus:

1. **Notificação imediata**: emite `session/cancel` via JSON-RPC / ACP e inicia janela de tolerância de 5 segundos.
2. **Escalação com abort prompt**: se o agente não responder em 5 segundos, injeta prompt de abort instruindo parada imediata de agentes e subagentes, iniciando nova janela de 15 segundos.
3. **Cancelamento forçado**: se a tolerância expirar, força a rejeição local do turno pendente com `PromptCancelledError` e reenvia `session/cancel`.

## Demux de Streaming e Atividades

O `AgentStreamDemux` decompõe as notificações brutas do ACP em eventos tipados de negócio:

- `agent_thought_chunk`: agrupado em atividades `{ kind: 'thought', id, text }` emitidas para listeners registrados em `onActivity`.
- `tool_call` e `tool_call_update`: emitidos como atividades `{ kind: 'tool', toolCallId, title, status }`.
- `agent_message_chunk`: acumulado no buffer de turno e entregue como bloco final unificado no fechamento do gerador `prompt()`. Respostas vazias ou contendo apenas espaços não geram blocos textuais.

## Adaptadores ACP e Antigravity

A classe base `AbstractAcpAdapter` implementa a orquestração do protocolo ACP, o gerenciamento de sessões e a integração com o demux.

O `AntigravityAdapter` herda de `AbstractAcpAdapter` e provê:

- Resolução do binário do bridge (`agy-acp-bridge.js` em distribuição compilada ou `agy-acp-bridge.ts` em tempo de execução de desenvolvimento).
- Detecção e injeção da variável de ambiente `AGY_PATH` via `IFileSystemPort.resolveInPath('agy')` quando não previamente definida no ambiente.
- Execução isolada do bridge como subprocesso via `IProcessRunnerPort.spawn`.

## Regras Prescritivas

- **Proibido instanciar adaptadores diretamente em casos de uso**: obtenha instâncias sempre via `@Inject(IAgentPortFactory)` e `create()`.
- **Proibido acoplar o núcleo ao SDK do ACP**: os tipos e estruturas de dados do `@agentclientprotocol/sdk` devem permanecer restritos aos adaptadores e bridges. Casos de uso manipulam exclusivamente os tipos declarados em `agent.port.ts`.
- **Isolamento de I/O em adaptadores concretos**: qualquer chamada ao sistema de arquivos ou spawning de processos dentro de adaptadores deve utilizar `IFileSystemPort` e `IProcessRunnerPort`.
- **Limpeza de recursos obrigatória**: sempre garanta a execução de `closeSession()` ou `disconnect()` em blocos `finally` ou no descarte de recursos de orquestração.
