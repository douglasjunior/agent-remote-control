---
name: agent-definitions
description: >
  Padrão para definição, parametrização e registro de personas de agentes de IA no sistema.
  Governa os papéis AgentRole (CEO e DEVELOPER), o contrato AgentDefinition, a implementação
  do AgentRegistryService (IAgentRegistryPort), os system prompts especializados e o
  direcionamento de tarefas. Use ao criar, modificar ou consultar personas e papéis de agentes.
---

# Definição e Registro de Agentes de IA

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar qualquer regra descrita aqui. O critério não
> é qual regra — é a natureza da mudança: uma diretriz de papéis, convenção de registro
> ou estrutura de persona mudou → atualize; refator técnico que preserva o padrão
> descrito → não toque.

O módulo `AgentDefinitionsModule` reside em `src/modules/agent-definitions/` e centraliza
o catálogo de personas, system prompts especializados e parametrizações de modelos para os
agentes de desenvolvimento do sistema.

## Modelagem dos Agentes

### Papéis Funcionais (`AgentRole`)

A tipagem `AgentRole` define os papéis canônicos de agentes:

```typescript
export type AgentRole = 'CEO' | 'DEVELOPER';
```

- **`CEO`**: Líder do time de agentes. Conversa com o usuário, faz a triagem, delega todo o trabalho prático aos demais agentes e revisa os resultados.
- **`DEVELOPER`**: Engenheiro de software sênior autônomo, agnóstico a stacks ou arquiteturas específicas, focado em adaptar-se à arquitetura do projeto alvo, implementação de código, testes automatizados e operações de Git.

### Contrato de Definição (`AgentDefinition`)

Cada agente é descrito pela estrutura `AgentDefinition`:

- `role`: identificador textual do papel (`AgentRole` ou identificador personalizado);
- `name`: rótulo legível do agente;
- `description`: resumo descritivo de especialidade e propósito;
- `buildSystemPrompt(team)`: monta o prompt do agente. Recebe `team`, as demais definições registradas, para que agentes que delegam listem seu time. Agentes executores ignoram o parâmetro;
- `defaultModel`: modelo de linguagem padrão opcional associado à persona;
- `turnReminder`: lembrete de turno obrigatório (`string`) injetado no prompt de cada rodada do agente.

## Prompts do Sistema Especializados

Os prompts especializados residem em `src/modules/agent-definitions/prompts/`:

Todo prompt de agente termina com `FINAL_RESPONSE_INSTRUCTIONS` (`final-response.prompt.ts`): a
resposta final do turno vem uma única vez dentro de `<final_response>…</final_response>`
(`agent/constants/final-response.constant.ts`), e o texto fora dele é só narração de progresso.
Um novo agente precisa incluir esse bloco, porque o demux usa o envelope para separar a resposta
da narração.

### 1. Developer Agent (`developer.prompt.ts`)

- Atua como engenheiro de software sênior autônomo, adaptável a qualquer linguagem, stack ou arquitetura;
- Inspeciona e adere estritamente à arquitetura, convenções, linter e documentação do projeto de destino (`AGENTS.md`, README, etc.);
- Adota os padrões e convenções idiomáticas já estabelecidos na base de código existente quando não houver documentação formal;
- Garante qualidade através de testes automatizados abrangentes e validação com os comandos de compilação, teste e linter do projeto alvo;
- Incorpora as habilidades de Git (`GIT_ABILITY`) e Planejamento (`PLAN_ABILITY`);
- Possui o lembrete `DEVELOPER_TURN_REMINDER` configurado em sua definição, reforçando a cada turno a aderência a convenções, testes automatizados e o envelope `<final_response>`.

### 2. CEO (`ceo.prompt.ts`)

- Lidera o time de agentes e conversa diretamente com o usuário;
- Atua em orquestração pura: nunca executa tarefas técnicas diretamente, não cria nem altera arquivos de projeto, não executa testes, builds ou linters, e não faz commits. Todo trabalho técnico prático deve ser delegado a agentes especialistas do time. Quando nenhum agente do time puder atender ao pedido, relata a limitação ao usuário sem tentar executar a tarefa;
- Faz a triagem dos pedidos e converte requisitos ambíguos em tarefas com especificação autocontida e critérios de aceitação;
- Conhece seu time pela seção "Your Team", gerada por `buildCeoSystemPrompt(team)` a partir do registry com papel, nome e descrição de cada agente. Por isso a `description` de cada definição deve dizer quando delegar a ele;
- Delega via protocolo de marcadores, escritos na última linha do envelope de resposta final, usando um papel do time, e revisa cada resultado antes de concluir;
- Possui o lembrete `CEO_TURN_REMINDER` configurado em sua definição, reforçando o papel de orquestração pura e o contrato dos marcadores a cada turno;
- Conversa de forma natural e proporcional à mensagem, seguindo as regras de confinamento e protocolo sem mencioná-las ao usuário;
- Não incorpora habilidades de execução (`PLAN_ABILITY`, `GIT_ABILITY`), pois as instruções delas são de quem executa.

## Serviço de Registro (`AgentRegistryService`)

A classe `AgentRegistryService` implementa a porta `IAgentRegistryPort` de `src/modules/orchestrator/ports/agent-registry.port.ts`:

- `getSystemPrompt(agentRole: string)`: resolve a definição de forma case-insensitive e chama `buildSystemPrompt` com todas as outras definições registradas. Papéis não registrados recebem um prompt genérico;
- `getDefaultModel(agentRole: string)`: retorna o identificador do modelo preferencial associado ao papel;
- `getTurnReminder(agentRole: string)`: retorna o lembrete de turno associado ao papel (`turnReminder`), ou texto padrão de fallback para papéis não registrados (sempre string, nunca null ou undefined);
- `hasRole(agentRole: string)`: indica, de forma case-insensitive, se o papel está registrado;
- `getDefinition(roleOrId: string)`: recupera a entidade completa `AgentDefinition`;
- `getAllDefinitions()`: lista todas as definições registradas;
- `registerDefinition(definition: AgentDefinition)`: permite inclusão dinâmica ou sobrescrita em tempo de execução. Um agente registrado passa a constar na seção "Your Team" do prompt do CEO.

O `AgentDefinitionsModule` registra `IAgentRegistryPort` com `useExisting: AgentRegistryService`, garantindo uma única instância. Com `useClass`, definições registradas pela classe exportada não chegariam ao orquestrador.
