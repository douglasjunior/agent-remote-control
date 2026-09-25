---
name: agent-abilities
description: >
  Diretrizes de habilidades dos agentes de IA para operações de Git e modo de planejamento.
  Governa as convenções de commit em pt-BR (Conventional Commits), regras de segurança
  em repositórios, fluxo de inspeção prévia de código no Plan Mode e injeção de habilidades
  nos prompts dos agentes. Use ao criar, estender ou consultar habilidades e prompts.
---

# Habilidades dos Agentes (Git e Planejamento)

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar qualquer regra descrita aqui. O critério não
> é qual regra — é a natureza da mudança: uma diretriz de habilidade, convenção de commit
> ou fluxo de planejamento mudou → atualize; refator técnico que preserva o padrão
> descrito → não toque.

As habilidades residem em `src/modules/workspace/abilities/` e compõem as instruções
especializadas injetadas nos prompts dos agentes de IA da aplicação.

## Habilidade de Git (`git.ability.ts`)

A habilidade `GIT_ABILITY` padroniza a interação com repositórios clonados sob o diretório
de workspaces da aplicação.

### Convenção de Commits (Conventional Commits em pt-BR)

Todo commit gerado pelos agentes ou pelo projeto deve seguir o padrão:

```text
<tipo>: <assunto>
```

- **Tipos aceitos**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
- **Idioma do assunto**: estritamente em **português (pt-BR)**.
- **Tempo verbal**: verbo no presente do indicativo (ex.: `adiciona suporte`, `corrige falha`, `implementa use case`, `remove arquivo`).
- **Tamanho máximo**: linha de assunto (*subject*) com até 50 caracteres.
- **Pontuação**: sem ponto final no término do assunto.
- **Corpo detalhado**: quando houver detalhes ou contexto extenso, separe o corpo por uma linha em branco.

### Regras de Segurança no Git

- **Proibição de force push**: comandos como `git push --force` ou `-f` são estritamente proibidos.
- **Verificação prévia de status**: inspecione `git status` e `git diff` antes de adicionar arquivos ou commitar.
- **Proteção de credenciais e segredos**: arquivos sensíveis, chaves privadas, tokens de API e arquivos `.env` nunca devem ser comitados.
- **Integridade do código**: nunca commite código com compilação quebrada ou testes em falha.

## Habilidade de Planejamento (`plan.ability.ts`)

A habilidade `PLAN_ABILITY` instrui o modo de planejamento ("Plan Mode"), assegurando que o
agente compreenda o contexto antes de produzir alterações de código.

### Fases do Planejamento

1. **Exploração e Inspeção**:
   - Mapear a arquitetura, pastas e padrões estabelecidos no repositório antes de editar;
   - Inspecionar dependências instaladas, scripts no `package.json` e suíte de testes.

2. **Formulação do Plano**:
   - Estruturar os passos lógicos da implementação antes de modificar qualquer arquivo;
   - Listar arquivos a criar, alterar ou excluir;
   - Identificar limites arquiteturais (Ports, Adapters, Use Cases);
   - Solicitar alinhamento com o usuário caso existam requisitos ambíguos.

3. **Execução e Verificação**:
   - Aplicar alterações em etapas atômicas;
   - Garantir 100% de cobertura de testes unitários para novas linhas executáveis;
   - Executar linters e suíte de testes garantindo estado verde e sem erros.
