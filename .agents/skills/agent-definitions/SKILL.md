---
name: agent-definitions
description: >
  Padrão para definição, parametrização e registro de personas de agentes de IA no sistema.
  Governa os papéis AgentRole (CEO, DEVELOPER, CODE_REVIEWER e TECH_LEAD), o contrato AgentDefinition, a implementação
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
export type AgentRole = 'CEO' | 'DEVELOPER' | 'CODE_REVIEWER' | 'TECH_LEAD';
```

- **`CEO`**: Líder do time de agentes. Conversa com o usuário, faz a triagem, delega todo o trabalho prático aos demais agentes e revisa os resultados.
- **`TECH_LEAD`**: Especialista em planejamento técnico, exploração arquitetural, levantamento de impacto e especificação decomposta para o DEVELOPER. Atua de forma consultiva com alinhamento Human-in-the-loop em decisões críticas e trade-offs de design.
- **`DEVELOPER`**: Engenheiro de software sênior autônomo, agnóstico a stacks ou arquiteturas específicas, focado em adaptar-se à arquitetura do projeto alvo, implementação de código, testes automatizados e operações de Git.
- **`CODE_REVIEWER`**: Revisor de código crítico e independente, focado em inspecionar alterações e propor melhorias técnicas, aderência a convenções e prevenção de bugs sem viés de implementações anteriores.

### Contrato de Definição (`AgentDefinition`)

Cada agente é descrito pela estrutura `AgentDefinition`:

- `role`: identificador textual do papel (`AgentRole` ou identificador personalizado);
- `name`: rótulo legível do agente;
- `description`: resumo descritivo de especialidade e propósito;
- `buildSystemPrompt(team)`: monta o prompt do agente. Recebe `team`, as demais definições registradas, para que agentes que delegam listem seu time. Agentes executores ignoram o parâmetro;
- `defaultModel`: modelo de linguagem padrão opcional associado à persona;
- `defaultSessionMode`: modo de sessão padrão (`'resume' | 'new'`, padrão `'resume'`). Quando `'new'`, o orquestrador inicia sempre uma nova sessão ACP para o agente;
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

- Lidera e orquestra o time de agentes no `agent-remote-control`, atuando como interface conversacional primária com o usuário (via Discord e outros canais);
- Compreende o diretório `workspaces` como contêiner multi-projeto; inspeciona o CWD e o catálogo `workspace-manifest.json` para descobrir projetos e repositórios ativos;
- Ancora o escopo e as respostas ao usuário nos projetos de fato existentes no workspace, propondo clonar ou iniciar novos via DEVELOPER caso esteja vazio;
- Opera com confinamento padrão ao `workspaces` e suas subpastas; atuar fora do workspace é perigoso e exige alerta explícito de risco e confirmação prévia obrigatória do usuário antes de prosseguir;
- Atua em orquestração pura: nunca executa tarefas técnicas diretamente, não cria nem altera arquivos de projeto, não executa testes, builds ou linters, e não faz commits. Todo trabalho técnico prático deve ser delegado a agentes especialistas do time. Quando nenhum agente do time puder atender ao pedido, relata a limitação ao usuário sem tentar executar a tarefa;
- Faz a triagem dos pedidos e converte requisitos ambíguos em tarefas com especificação autocontida e critérios de aceitação;
- Conhece seu time pela seção "Your Team", gerada por `buildCeoSystemPrompt(team)` a partir do registry com papel, nome e descrição de cada agente. Por isso a `description` de cada definição deve dizer quando delegar a ele;
- Delega via protocolo de marcadores, escritos na última linha do envelope de resposta final, usando um papel do time, e revisa cada resultado antes de concluir;
- Exige que o parâmetro de pasta de projeto (`project-folder`) seja sempre o diretório raiz de primeiro nível do projeto, nunca caminhos aninhados ou subpastas internas, assegurando que o especialista inicie sua execução na raiz do workspace onde residem as habilidades e arquivos de governança; detalhes de escopos pontuais ou subdiretórios pertencem à especificação da tarefa;
- Possui o lembrete `CEO_TURN_REMINDER` configurado em sua definição, reforçando o papel de orquestração pura e o contrato dos marcadores a cada turno;
- Conversa de forma natural e proporcional à mensagem, seguindo as regras de confinamento e protocolo sem mencioná-las ao usuário;
- Não incorpora habilidades de execução (`PLAN_ABILITY`, `GIT_ABILITY`), pois as instruções delas são de quem executa.

### 3. Code Reviewer Agent (`code-reviewer.prompt.ts`)

- Atua como revisor de código e auditor sênior estritamente opinativo, focado em segurança, boas práticas, legibilidade, concisão e prevenção de regressões;
- Nunca implementa correções nem edita arquivos de código diretamente: aponta achados com severidade (`CRITICAL`, `MAJOR`, `MINOR`, `SUGGESTION`), linha/arquivo e sugestão concisa de solução;
- Quando a revisão envolve um Pull Request (PR), sugere proativamente ao final do relatório a publicação dos achados como comentários no PR e solicita ao usuário que indique quais achados (por número, severidade ou todos) deseja publicar;
- Executa ferramentas de leitura, linter ou testes apenas para inspeção quando necessário;
- Opera por padrão em sessão nova (`defaultSessionMode: 'new'`) para auditar código sem viés de implementações anteriores ou contexto prévio acumulado;
- Possui o lembrete `CODE_REVIEWER_TURN_REMINDER` configurado em sua definição, reforçando que é apenas revisor e não executor.

### 4. Tech Lead Agent (`tech-lead.prompt.ts`)

- Atua como arquiteto de software e líder técnico responsável por análise profunda de requisitos, exploração de arquitetura e levantamento prévio de impacto no repositório;
- Opera sob disciplina estritamente somente-leitura: não altera arquivos, não gera código de produção e não realiza commits ou patches diretamente;
- Adota abordagem consultiva com alinhamento Human-in-the-Loop (HITL): ao identificar ambiguidades, trade-offs arquiteturais relevantes ou dependências não consolidadas, formula opções estruturadas com prós e contras, apresenta recomendação justificada e solicita alinhamento antes de consolidar o plano;
- Prioriza documentação autoritativa (skills locais, guias arquiteturais) e mapeia divergências (drift) para decisão explícita;
- Produz planos estruturados contendo Visão Geral e Objetivos, Decisões Técnicas e Arquitetura, Análise de Impacto com caminhos reais de arquivos, Decomposição Sequencial de Tarefas para o DEVELOPER (com dependências explícitas e testes integrados em cada tarefa) e Critérios de Aceitação/Verificação com comandos concretos;
- Opera por padrão em sessão persistida (`defaultSessionMode: 'resume'`) para sustentar refinamentos iterativos e alinhamentos conversacionais com o CEO ou usuário;
- Possui o lembrete `TECH_LEAD_TURN_REMINDER` configurado em sua definição, reforçando o papel de planejamento, disciplina somente-leitura, HITL e tarefas com critérios verificáveis.

## Serviço de Registro (`AgentRegistryService`)

A classe `AgentRegistryService` implementa a porta `IAgentRegistryPort` de `src/modules/orchestrator/ports/agent-registry.port.ts`:

- `getSystemPrompt(agentRole: string)`: resolve a definição de forma case-insensitive e chama `buildSystemPrompt` com todas as outras definições registradas. Papéis não registrados recebem um prompt genérico;
- `getDefaultModel(agentRole: string)`: retorna o identificador do modelo preferencial associado ao papel;
- `getDefaultSessionMode(agentRole: string)`: retorna o modo de sessão padrão do papel (`'resume' | 'new'`), recorrendo a `'resume'` se não configurado ou desconhecido;
- `getTurnReminder(agentRole: string)`: retorna o lembrete de turno associado ao papel (`turnReminder`), ou texto padrão de fallback para papéis não registrados (sempre string, nunca null ou undefined);
- `hasRole(agentRole: string)`: indica, de forma case-insensitive, se o papel está registrado;
- `getDefinition(roleOrId: string)`: recupera a entidade completa `AgentDefinition`;
- `getAllDefinitions()`: lista todas as definições registradas;
- `registerDefinition(definition: AgentDefinition)`: permite inclusão dinâmica ou sobrescrita em tempo de execução. Um agente registrado passa a constar na seção "Your Team" do prompt do CEO.

O `AgentDefinitionsModule` registra `IAgentRegistryPort` com `useExisting: AgentRegistryService`, garantindo uma única instância. Com `useClass`, definições registradas pela classe exportada não chegariam ao orquestrador.
