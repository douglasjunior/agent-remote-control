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

- **`CEO`**: Agente executivo de triagem, planejamento estratégico, refinamento de escopo e roteamento de tarefas técnicas para o Developer Agent.
- **`DEVELOPER`**: Engenheiro de software sênior autônomo, agnóstico a stacks ou arquiteturas específicas, focado em adaptar-se à arquitetura do projeto alvo, implementação de código, testes automatizados e operações de Git.

### Contrato de Definição (`AgentDefinition`)

Cada agente é descrito pela estrutura `AgentDefinition`:

- `role`: identificador textual do papel (`AgentRole` ou identificador personalizado);
- `name`: rótulo legível do agente;
- `description`: resumo descritivo de especialidade e propósito;
- `systemPrompt`: texto completo de instruções comportamentais e diretrizes operacionais;
- `defaultModel`: modelo de linguagem padrão opcional associado à persona.

## Prompts do Sistema Especializados

Os prompts especializados residem em `src/modules/agent-definitions/prompts/`:

### 1. Developer Agent (`developer.prompt.ts`)

- Atua como engenheiro de software sênior autônomo, adaptável a qualquer linguagem, stack ou arquitetura;
- Inspeciona e adere estritamente à arquitetura, convenções, linter e documentação do projeto de destino (`AGENTS.md`, README, etc.);
- Adota os padrões e convenções idiomáticas já estabelecidos na base de código existente quando não houver documentação formal;
- Garante qualidade através de testes automatizados abrangentes e validação com os comandos de compilação, teste e linter do projeto alvo;
- Incorpora as habilidades de Git (`GIT_ABILITY`) e Planejamento (`PLAN_ABILITY`).

### 2. CEO / Router Agent (`ceo.prompt.ts`)

- Responsável pela triagem inicial dos pedidos recebidos dos usuários;
- Converte requisitos ambíguos em marcos técnicos objetivos e critérios de aceitação;
- Delega a execução das tarefas de desenvolvimento ao papel `DEVELOPER`;
- Incorpora as diretrizes da habilidade de Planejamento (`PLAN_ABILITY`).

## Serviço de Registro (`AgentRegistryService`)

A classe `AgentRegistryService` implementa a porta `IAgentRegistryPort` de `src/modules/orchestrator/ports/agent-registry.port.ts`:

- `getSystemPrompt(agentRoleOrId?: string)`: resolve o prompt comportamental da persona de forma case-insensitive, fornecendo fallback amigável caso o papel não esteja pré-configurado;
- `getDefaultModel(agentRoleOrId?: string)`: retorna o identificador do modelo preferencial associado ao papel;
- `getDefinition(roleOrId: string)`: recupera a entidade completa `AgentDefinition`;
- `getAllDefinitions()`: lista todas as definições registradas;
- `registerDefinition(definition: AgentDefinition)`: permite inclusão dinâmica ou sobrescrita em tempo de execução.
