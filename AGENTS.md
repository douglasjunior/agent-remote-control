# AGENTS — Agent Remote Control

## Visão Geral

O **Agent Remote Control** é uma aplicação NestJS voltada para o controle e orquestração remota de agentes de Inteligência Artificial para desenvolvimento de software, operando sobre o **Agent Client Protocol (ACP)** e oferecendo interface primária através de um **Bot do Discord**.

A arquitetura do projeto adota **Clean Architecture com Ports & Adapters**, desacoplando o núcleo de negócio das tecnologias externas (Discord, SDK do ACP, sistema de arquivos e processos). A orquestração do comportamento e das regras de negócio é realizada diretamente por **Casos de Uso (Use Cases)** independentes e coesos.

Todo o código-fonte, identificadores e testes são escritos em **inglês**, enquanto a documentação, skills, especificações e mensagens de commit são escritas em **pt-BR**.

## Estrutura do Repositório

```text
agent-remote-control/
├── .agents/                        # Governança, contexto e habilidades dos agentes de IA
│   ├── context/                    # Decisões duráveis e descobertas validadas com o usuário
│   ├── maps/                       # Mapas conceituais e de domínio
│   ├── skills/                     # Catálogo de habilidades sob demanda (SKILL.md)
│   └── specs/                      # Especificações, planos e tarefas (fluxo spec-driven)
├── src/                            # Código-fonte da aplicação NestJS
│   ├── modules/                    # Módulos verticais segregados por domínio
│   │   ├── agent/                  # Integração ACP: porta IAgentPort, fábrica, adapters, bridges e demux
│   │   ├── agent-definitions/      # Catálogo de agentes (CEO, DEVELOPER), prompts e registry
│   │   ├── discord/                # Bot do Discord: handlers, formatters e utils de progresso
│   │   ├── orchestrator/           # Turnos, fila por conversa, delegação e cancelamento
│   │   └── workspace/              # Diretório de workspaces, manifest e habilidades (abilities)
│   │
│   │   Pastas internas de um módulo (cada módulo usa apenas as que precisa):
│   │       ├── abilities/          # Blocos de instruções reutilizáveis injetados em prompts
│   │       ├── adapters/           # Adaptadores secundários/tecnológicos (*.adapter.ts)
│   │       ├── bridges/            # Processos ponte entre protocolos (ex.: ACP ↔ agy)
│   │       ├── constants/          # Constantes de domínio
│   │       ├── demux/              # Decomposição de streams em eventos tipados
│   │       ├── formatters/         # Formatação de saída para o canal
│   │       ├── handlers/           # Adaptadores primários/driving (Discord events/commands)
│   │       ├── models/             # Tipos e modelos de domínio (*.model.ts, *.type.ts)
│   │       ├── ports/              # Interfaces e Symbols de injeção (*.port.ts)
│   │       ├── prompts/            # System prompts dos agentes (*.prompt.ts)
│   │       ├── services/           # Serviços concretos de apoio (*.service.ts)
│   │       ├── testing/            # Stubs, fakes e fixtures compartilhados pelos testes
│   │       ├── use-cases/          # Regras de negócio e orquestração (*.use-case.ts)
│   │       ├── utils/              # Utilitários sem estado de domínio (*.util.ts)
│   │       └── <nome>.module.ts    # Configuração do módulo e amarração de DI NestJS
│   ├── app.controller.ts           # Controller raiz de diagnóstico/healthcheck
│   ├── app.module.ts               # Módulo raiz da aplicação
│   ├── app.service.ts              # Service raiz da aplicação
│   └── main.ts                     # Bootstrap da aplicação NestJS
├── test/                           # Testes e2e e utilitários globais de teste
├── vitest.config.ts                # Configuração do Vitest para testes unitários
├── vitest.config.e2e.ts            # Configuração do Vitest para testes e2e
├── tsconfig.json                   # Configuração base do TypeScript
├── nest-cli.json                   # Configuração da CLI do NestJS
└── package.json                    # Dependências e scripts do projeto
```

## Estrutura `.agents/`

- `.agents/skills/`: Skills carregadas sob demanda pelo agente. Cada pasta contém um `SKILL.md` prescritivo.

Antes de executar qualquer modificação ou criação de código, consulte o catálogo em `.agents/skills/` inspecionando a `description` de cada frontmatter para carregar as regras mandatórias do tópico.

## Convenções Transversais

- **Mensagens de commit**: Padrão Conventional Commits (Angular) em **pt-BR**, verbo no presente do indicativo, linha de assunto (*subject*) com até 50 caracteres e sem ponto final. Quando houver contexto detalhado, separe o corpo por uma linha em branco.
- **Idioma**:
  - Código em **inglês**: identificadores, nomes de arquivos, classes, interfaces, métodos, variáveis e descrições de testes (`describe`, `it`).
  - Documentação em **português (pt-BR)**: `AGENTS.md`, README, skills em `.agents/skills/`, especificações em `.agents/specs/` e artefatos de contexto.
- **Testes com Vitest**:
  - Testes unitários colocados lado a lado com os arquivos testados sob o padrão `*.spec.ts`.
  - Meta de **100% de cobertura** das linhas executáveis de código de produção.
  - `vi.mock` é restrito **exclusivamente a fronteiras externas de I/O** (SDKs de terceiros como Discord.js, ACP SDK e módulos nativos do Node como `node:fs` e `node:child_process`). Código interno em `src/` **nunca** é mockado com `vi.mock`; utiliza-se stubs/fakes que implementam as portas (`implements IMyPort`).
- **Proibição de barrel exports (`index.ts`)**:
  - Não use arquivos `index.ts` que reexportam símbolos de pastas ou módulos. Importe sempre diretamente do arquivo de origem do símbolo para evitar acoplamento desnecessário e dependências circulares.

## Escrita de Comentários e Documentação

Todo texto mantido no repositório descreve o **estado atual**, escrito para quem lê o arquivo hoje sem necessidade de consultar o histórico do repositório ou conversas anteriores:

- **Descreva o que é, nunca a transição**: Escreva o texto a partir do resultado consolidado. Expressões como "não mais", "passou a", "agora é", "antes era", "em vez de" e "sem precisar" são proibidas, exceto quando relatam decisões de negócio em mensagens de commit ou specs de migração.
- **Negue apenas para evitar erro plausível**: Uma restrição negativa ("não utilize X") só se justifica quando um leitor competente tentaria X e a frase explica por que isso causaria falha.
- **Teste das três perguntas antes de comentar**:
  1. Ele diz algo que o código não expressa?
  2. Um leitor competente tentaria a alternativa que ele descarta?
  3. Ele continuará verdadeiro após a próxima refatoração?
- **Passe de poda obrigatório**: Antes de concluir qualquer tarefa, inspecione as adições de documentação e comentários no diff (`git diff`) e corte o que for redundante ou óbvio.

## Comandos Essenciais

- Instalação de dependências: `yarn install`
- Modo de desenvolvimento com watch: `yarn start:dev`
- Compilação / build: `yarn build`
- Checagem estática de tipos TypeScript: `yarn ts`
- Linter: `yarn lint`
- Formatação de código via ESLint: `yarn format` (ou `yarn lint:fix`)
- Execução de testes unitários: `yarn test`
- Cobertura de testes: `yarn test:cov`
- Testes ponta a ponta (e2e): `yarn test:e2e`

## Regras Mandatórias para Agentes de IA

1. **Consultar skills antes de agir**: Antes de criar ou alterar código, verifique o catálogo em `.agents/skills/` e siga a skill governante.
2. **Respeitar o padrão Clean Architecture NestJS**:
   - Casos de uso orquestram regras de negócio (`*.use-case.ts`).
   - Portas definem interfaces e Symbols de injeção (`*.port.ts`).
   - Adaptadores implementam portas técnicas (`*.adapter.ts`).
   - Injeção de dependência via `@Inject(IMyPort)`.
   - Módulos NestJS configuram provedores associando Symbol à classe concreta (`{ provide: IMyPort, useClass: MyAdapter }`).
3. **Orquestração via Use Cases**: Toda a lógica de negócio e coordenação de fluxo é realizada exclusivamente por classes de Use Case (`*.use-case.ts`). Não utilize classes de workflow.
4. **Sem barrel exports**: Importe classes, portas e tipos diretamente do arquivo de definição, sem `index.ts`.
5. **Nenhum comentário óbvio**: Não repita o que o código, tipagem ou assinatura já dizem.
6. **Stubs e Fakes em vez de vi.mock interno**: Isole dependências internas de `src/` injetando stubs no construtor ou substituindo providers no `Test.createTestingModule`.
7. **Passe de poda antes de encerrar**: Verifique comentários e textos introduzidos no diff e remova qualquer ruído antes de submeter.
8. **Execução mandatória de checagem de tipos, lint e testes em toda modificação**: Toda e qualquer alteração de código no projeto exige a execução de `yarn ts`, `yarn lint` e `yarn test` (além de `yarn test:e2e` ao tocar em pontos de entrada). A formatação do código é de responsabilidade exclusiva do ESLint (`yarn format`). Nenhuma entrega pode ser concluída com erros de TypeScript, erros de lint ou falhas de testes.
