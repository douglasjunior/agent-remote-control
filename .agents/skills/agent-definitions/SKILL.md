---
name: agent-definitions
description: >
  Padrão para definição, parametrização e registro de personas de agentes de IA no sistema.
  Governa os papéis AgentRole (CEO, GIT_OPS, DEVELOPER, CODE_REVIEWER e TECH_LEAD), o contrato AgentDefinition
  com seu contrato de delegação, a implementação
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
export type AgentRole =
  | 'CEO'
  | 'GIT_OPS'
  | 'DEVELOPER'
  | 'CODE_REVIEWER'
  | 'TECH_LEAD';
```

- **`CEO`**: Líder do time de agentes. Conversa com o usuário, faz a triagem, delega todo o trabalho prático aos demais agentes e revisa os resultados.
- **`TECH_LEAD`**: Especialista em planejamento técnico, exploração arquitetural, levantamento de impacto e especificação decomposta para o DEVELOPER. Atua de forma consultiva com alinhamento Human-in-the-loop em decisões críticas e trade-offs de design.
- **`GIT_OPS`**: Dono das operações avulsas de Git que alcançam um remoto — clone, init, fetch, pull, push, merge e rebase contra branches remotas, configuração de remote, pull requests e setup de chave SSH. Mantém o `workspace-manifest.json` na raiz de workspaces como de→para de URL de repositório para pasta de projeto, e é seu único escritor (o CEO o lê para localizar repositórios). Não executa scripts do projeto, mesmo quando eles clonam ou fazem fetch internamente.
- **`DEVELOPER`**: Engenheiro de software sênior autônomo, agnóstico a stacks ou arquiteturas específicas, focado em adaptar-se à arquitetura do projeto alvo, implementação de código e testes automatizados. No Git opera só o lado local: inspeção da árvore de trabalho, branches locais e commit do próprio trabalho. Executa os comandos que o projeto documenta (scripts do `package.json`, alvos de Makefile, scripts de setup ou init do README/AGENTS.md), mesmo quando instalam dependências ou clonam sub-repositórios.
- **`CODE_REVIEWER`**: Revisor de código crítico e independente, focado em inspecionar alterações e propor melhorias técnicas, aderência a convenções e prevenção de bugs sem viés de implementações anteriores.

### Contrato de Definição (`AgentDefinition`)

Cada agente é descrito pela estrutura `AgentDefinition`:

- `role`: papel do agente, restrito à união `AgentRole`;
- `name`: rótulo legível do agente;
- `description`: resumo descritivo de especialidade e propósito;
- `buildSystemPrompt(team)`: monta o prompt do agente. Recebe `team`, as demais definições registradas, para que agentes que delegam listem seu time. Agentes executores ignoram o parâmetro;
- `defaultModel`: modelo de linguagem padrão opcional associado à persona;
- `defaultSessionMode`: modo de sessão padrão (`'resume' | 'new'`, padrão `'resume'`). Quando `'new'`, o orquestrador inicia sempre uma nova sessão ACP para o agente;
- `delegation`: contrato de delegação do agente (`AgentDelegationContract`), declarando quais parâmetros do marcador ele aceita. `project` vale `'required'` ou `'optional'`; ausente, o agente não recebe pasta de projeto. `sessionMode` vale `'overridable'`; ausente, o modo fica fixo no `defaultSessionMode` e passar `:new` ou `:resume` é recusado. O conjunto é particular de cada agente, e um parâmetro novo se acrescenta aqui;
- `turnReminder`: lembrete de turno opcional (`string`) anexado ao prompt de cada rodada do agente;
- `systemPromptEveryTurn`: quando `true`, o orquestrador prefixa o system prompt em toda rodada, inclusive em sessão retomada e no prompt de reparo. Serve a agentes de sessão longa, cujo contexto é compactado e perde o prompt enviado na criação da sessão; o agente dispensa o `turnReminder`;
- `buildWorkspaceFiles(team, workspaceDir)`: opcional, devolve `WorkspaceFile[]` (`path` relativo à raiz de workspaces e `content`) que o orquestrador grava na raiz de workspaces a cada boot.

### Fronteira de CWD dos agentes executores

Todo agente executor inclui `CWD_BOUNDARY_INSTRUCTIONS` no system prompt e `CWD_BOUNDARY_REMINDER`
no `turnReminder` (`prompts/cwd-boundary.prompt.ts`). O agente não lê, lista nem altera nada fora
do CWD, a menos que o prompt recebido autorize aquele caminho exato e o modo (leitura ou escrita).
Precisando de algo de fora, como um SDK instalado na máquina, para e devolve na resposta final um
pedido de acesso com caminho, motivo e modo. O CEO avalia, pede confirmação ao usuário quando o
caminho sai do workspace, e autoriza delegando de novo ao mesmo papel com `:resume`. O GIT_OPS
tem `$HOME/.ssh` autorizado no próprio prompt para o setup de chave SSH.

### Quem pode nomear quem

Um prompt de agente executor descreve apenas a si mesmo. Ele recebe `team` em
`buildSystemPrompt(team)` e o ignora, então não possui seção "Your Team" e nomear outro papel
dentro dele cria referência a algo que o agente não conhece. Limites de escopo se escrevem no
negativo sobre o próprio agente ("fora do seu escopo; devolva ao chamador"), nunca apontando o
papel que assume a tarefa.

Só o prompt do CEO enxerga o time, e mesmo nele o conhecimento sobre cada agente mora na
`description` da definição, renderizada em "Your Team". As instruções genéricas do prompt do CEO
não citam papéis: um agente novo passa a ser roteado escrevendo a própria `description`, sem
editar o prompt do CEO.

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
- Usa o comando que o projeto documenta para a tarefa em vez de reproduzir seus passos manualmente, inclusive quando o comando acessa a rede, como instalação de dependências ou script de init que clona sub-repositórios;
- Incorpora as convenções de commit (Conventional Commits em pt-BR) e as regras de segurança do commit; declara operações avulsas de Git contra um remoto como fora do próprio escopo e as devolve ao chamador em vez de executá-las, sem nomear quem as executa;
- Possui o lembrete `DEVELOPER_TURN_REMINDER` configurado em sua definição, reforçando a cada turno a aderência a convenções, testes automatizados e o envelope `<final_response>`.

### 2. CEO (`ceo.prompt.ts`)

- Lidera e orquestra o time de agentes no `agent-remote-control`, atuando como interface conversacional primária com o usuário (via Discord e outros canais);
- Compreende o diretório `workspaces` como contêiner multi-projeto; lista o CWD para descobrir os projetos ativos, já que cada subpasta direta é um projeto;
- Ancora o escopo e as respostas ao usuário nos projetos de fato existentes no workspace, propondo clonar ou iniciar novos caso esteja vazio;
- Opera com confinamento padrão ao `workspaces` e suas subpastas; atuar fora do workspace é perigoso e exige alerta explícito de risco e confirmação prévia obrigatória do usuário antes de prosseguir;
- Atua em orquestração pura: nunca executa tarefas técnicas diretamente, não cria nem altera arquivos de projeto, não executa testes, builds ou linters, e não faz commits. Todo trabalho técnico prático deve ser delegado a agentes especialistas do time. Quando nenhum agente do time puder atender ao pedido, relata a limitação ao usuário sem tentar executar a tarefa;
- Faz a triagem dos pedidos e converte requisitos ambíguos em tarefas com especificação autocontida e critérios de aceitação;
- Recebe o prompt núcleo (`buildCeoSystemPrompt(team)`, envolto em `[ORCHESTRATOR_INSTRUCTIONS]`) em todo turno via `systemPromptEveryTurn`, com as regras que não podem se perder na compactação: orquestração pura, formas de marcador por agente, pasta de projeto como subpasta direta existente, quando usar `:new`, pedidos de acesso fora do CWD e sintaxe de anexos. O detalhe vive no `AGENTS.md` e nas skills que `buildCeoWorkspaceFiles` gera na raiz de workspaces (`agent-team`, `delegation-protocol`, `response-protocol`, `workspace-navigation`). O prompt núcleo não indexa as skills, que são descobertas pela própria `description`;
- Conhece seu time pela seção "Your Team" do prompt núcleo (papel, nome e formas de marcador derivadas do `delegation`) e pela skill `agent-team`, que traz a `description` completa de cada agente. A seção de delegação é agnóstica a papéis fixos: o roteamento de tarefas e o sequenciamento em fases (como planejamento antes da execução e revisão antes da conclusão) são orientados exclusivamente pelas especializações descritas dinamicamente no catálogo "Your Team". Por isso a `description` de cada definição deve dizer quando delegar a ele;
- Copia literalmente para a próxima especificação os comandos recomendados e os fatos já verificados que vêm nos resultados dos agentes, e pede o comando documentado pelo projeto em vez da reprodução manual dos seus passos;
- Delega via protocolo de marcadores, escritos na última linha do envelope de resposta final, usando um papel do time, e revisa cada resultado antes de concluir;
- Exige que o parâmetro de pasta de projeto (`project-folder`) seja sempre o diretório raiz de primeiro nível do projeto, nunca caminhos aninhados ou subpastas internas, assegurando que o especialista inicie sua execução na raiz do workspace onde residem os arquivos de governança e documentação; detalhes de escopos pontuais ou subdiretórios pertencem à especificação da tarefa;
- Lê o `workspace-manifest.json` para localizar repositórios pela URL, sem escrevê-lo;
- Conversa de forma natural e proporcional à mensagem, seguindo as regras de confinamento e protocolo sem mencioná-las ao usuário;
- Quando o usuário questiona uma decisão do próprio CEO, responde no mesmo turno com o contexto que já tem, e só delega se a resposta depender de informação que ainda não possui; quando o usuário pede para parar, para de delegar;
- Não realiza execução técnica direta, pois a implementação cabe exclusivamente aos agentes especialistas do time.

### 3. Code Reviewer Agent (`code-reviewer.prompt.ts`)

- Atua como revisor de código e auditor sênior estritamente opinativo, focado em segurança, boas práticas, legibilidade, concisão e prevenção de regressões;
- Não implementa correções em código de produção nem cria commits no repositório: aponta achados com severidade (`CRITICAL`, `MAJOR`, `MINOR`, `SUGGESTION`), linha/arquivo e sugestão concisa de solução;
- Tem autorização e responsabilidade para executar ferramentas MCP e comandos CLI para inspecionar o repositório e publicar comentários no PR/MR quando solicitado;
- Quando a revisão envolve um Pull Request (PR), sugere proativamente ao final do relatório a publicação dos achados como comentários no PR e solicita ao usuário que indique quais achados (por número, severidade ou todos) deseja publicar;
- Na publicação de comentários em PR/MR sob demanda, detecta automaticamente o provedor via `git remote -v` (GitHub, GitLab, Azure DevOps ou Bitbucket) e adota a hierarquia estrita de ferramentas `MCP -> CLI Oficial -> Sem Fallback`:
  1. **MCP (Model Context Protocol):** Primeira opção. Utiliza ferramentas MCP disponíveis para o provedor (ex.: Azure DevOps MCP como `repo_pull_request_thread_write`, GitHub MCP, etc.);
  2. **CLI Oficial:** Segunda opção. Na ausência de ferramentas MCP, utiliza CLIs oficiais autenticadas (`gh`, `glab`, `az`);
  3. **Sem Fallback Arbitrário:** Quando nem MCP nem CLI oficial estiverem disponíveis ou autenticados para o provedor, não executa chamadas manuais (`curl`, scripts ad-hoc ou requisições REST cruas) e relata a ausência de ferramental ao usuário;
- Ancora comentários pontuais inline na linha exata da nova versão no diff (`side: RIGHT` / `new_line` / `rightFileStart`, informando path e commit SHA) e comentários gerais/arquiteturais na discussão principal do PR/MR;
- Executa ferramentas de leitura, linter ou testes apenas para inspeção quando necessário;
- Opera por padrão em sessão nova (`defaultSessionMode: 'new'`) para auditar código sem viés de implementações anteriores ou contexto prévio acumulado;
- Possui o lembrete `CODE_REVIEWER_TURN_REMINDER` configurado em sua definição, reforçando o foco exclusivo em auditoria, o fluxo de publicação de achados e a hierarquia de ferramentas.

### 4. Tech Lead Agent (`tech-lead.prompt.ts`)

- Atua como arquiteto de software e líder técnico responsável por análise profunda de requisitos, exploração de arquitetura e levantamento prévio de impacto no repositório;
- Persona analítica e de uso geral: responde a consultas arquiteturais, investigações, análise de trade-offs de bibliotecas/tecnologias e elaboração de planos de implementação;
- Opera sob disciplina estritamente somente-leitura: não altera arquivos, não gera código de produção e não realiza commits ou patches diretamente;
- Adota abordagem consultiva com alinhamento Human-in-the-Loop (HITL): ao identificar ambiguidades, trade-offs arquiteturais relevantes ou dependências não consolidadas, formula opções estruturadas com prós e contras, apresenta recomendação justificada e solicita alinhamento antes de consolidar o plano;
- Prioriza documentação autoritativa (skills locais, guias arquiteturais) e mapeia divergências (drift) para decisão explícita;
- Produz planos estruturados entregues diretamente no chat (sem gerar arquivos em disco), contendo Visão Geral e Objetivos, Decisões Técnicas e Arquitetura, Análise de Impacto com caminhos reais de arquivos, Decomposição Sequencial de Tarefas para o DEVELOPER (com dependências explícitas e testes integrados em cada tarefa) e Critérios de Aceitação/Verificação com comandos concretos;
- Opera por padrão em sessão persistida (`defaultSessionMode: 'resume'`) para sustentar refinamentos iterativos e alinhamentos conversacionais com o CEO ou usuário;
- Possui o lembrete `TECH_LEAD_TURN_REMINDER` configurado em sua definição, reforçando o papel de planejamento, disciplina somente-leitura, HITL e tarefas com critérios verificáveis.

### 5. Git Ops Agent (`git-ops.prompt.ts`)

- Dono de toda operação de Git que alcança um remoto: clone, init, fetch, pull, push, merge e rebase contra branches remotas, configuração de remote, pull requests e setup de chave SSH;
- Deixa para o agente que implementa o lado local: staging, commit, branch local e inspeção da árvore de trabalho. Force push é proibido em qualquer circunstância;
- Opera em um de dois diretórios, decididos pelo chamador: a raiz de workspaces, para clonar ou localizar um repositório, e uma pasta de projeto, para operações sobre aquele repositório. Por isso seu contrato declara `project: 'optional'`;
- Único leitor e escritor do `workspace-manifest.json` na raiz de workspaces, um array JSON de `{ url, folder, defaultBranch }` que mapeia URL de repositório para pasta de projeto. Arquivo ausente significa workspace vazio;
- Deriva o nome da pasta do último segmento da URL sem o sufixo `.git`, regra exata porque o chamador roteia o trabalho seguinte por esse nome e um nome diferente duplicaria o clone;
- Relata no `GIT_OPS_TURN_REMINDER` a pasta de projeto usada, já que é assim que o CEO aprende para onde rotear a sequência.

## Serviço de Registro (`AgentRegistryService`)

A classe `AgentRegistryService` implementa a porta `IAgentRegistryPort` de `src/modules/orchestrator/ports/agent-registry.port.ts`:

- `getSystemPrompt(agentRole: string)`: resolve a definição de forma case-insensitive e chama `buildSystemPrompt` com todas as outras definições registradas. Papéis não registrados recebem um prompt genérico;
- `getDefaultModel(agentRole: string)`: retorna o identificador do modelo preferencial associado ao papel;
- `getDefaultSessionMode(agentRole: string)`: retorna o modo de sessão padrão do papel (`'resume' | 'new'`), recorrendo a `'resume'` se não configurado ou desconhecido;
- `getTurnReminder(agentRole: string)`: retorna o lembrete de turno associado ao papel (`turnReminder`), string vazia para definição sem lembrete, ou texto padrão de fallback para papéis não registrados (sempre string);
- `isSystemPromptEveryTurn(agentRole: string)`: indica se o papel recebe o system prompt em toda rodada (`false` para papel desconhecido);
- `getWorkspaceFiles(workspaceDir: string)`: agrega os `buildWorkspaceFiles` de todas as definições, cada uma com o próprio time;
- `hasRole(agentRole: string)`: indica, de forma case-insensitive, se o papel está registrado;
- `getDefinition(roleOrId: string)`: recupera a entidade completa `AgentDefinition`;
- `getAllDefinitions()`: lista todas as definições registradas;
- `registerDefinition(definition: AgentDefinition)`: permite inclusão dinâmica ou sobrescrita em tempo de execução. Um agente registrado passa a constar na seção "Your Team" do prompt do CEO.

O `AgentDefinitionsModule` registra `IAgentRegistryPort` com `useExisting: AgentRegistryService`, garantindo uma única instância. Com `useClass`, definições registradas pela classe exportada não chegariam ao orquestrador.
