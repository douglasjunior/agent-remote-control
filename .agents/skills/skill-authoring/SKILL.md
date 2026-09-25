---
name: skill-authoring
description: >
  Padrão para criar, revisar, atualizar ou dividir qualquer skill (de domínio ou
  técnica) em .agents/skills/. Define descoberta pelo agente via name e description,
  progressive disclosure em 3 níveis, limite de linhas e uso de references/, seções
  proibidas e manutenção anti-drift. Use ao escrever, editar, revisar ou organizar
  qualquer SKILL.md no projeto.
---

# Autoria de skills

> **Manutenção desta skill**
>
> Atualize este documento sempre que mudar **qualquer regra descrita aqui**. O critério não
> é *qual* regra — é a natureza da mudança: o padrão de autoria de skills mudou → atualize;
> ajuste cosmético em uma skill específica que preserva o padrão → não toque.

Estas regras aplicam-se a **qualquer** skill no repositório — domínio de negócio ou
técnica/transversal — e tanto ao **criar** quanto ao **atualizar** uma skill. Uma skill é
carregada sob demanda; cada decisão de autoria visa **gastar o menor contexto** da janela
de sessão para a maior utilidade.

## O que é uma skill (e o que não é)

Uma skill vive em `.agents/skills/<slug>/SKILL.md` e é a fonte autoritativa das decisões
duráveis sobre um escopo. Ela é **prescritiva**: define o que **deve** e o que **não deve**
ser feito, e não apenas o que existe.

Não crie uma skill cujo propósito exclusivo já pertença a outro canal: documentação de
API isolada (pertence ao OpenAPI ou testes de contrato), comentário de classe (pertence
ao código), decisão pontual (pertence ao commit/PR) ou tutorial introdutório passo a passo.
O que se evita é transformar em skill material que seja mera referência descritiva, sem
regra prescritiva própria.

## Como o agente descobre e carrega skills

O mecanismo de descoberta define a estrutura da skill:

- **Não há busca vetorial em tempo de execução.** O agente carrega o `name` e a `description`
  de **todas** as skills como texto estático no system prompt e decide o acionamento lendo esse
  texto.
- **Usa o texto literal.** A `description` não é resumida antes de chegar ao modelo. O que
  está escrito determina o carregamento.
- **Custo fixo por skill (~100 tokens: `name` + `description`)**, sempre presente na sessão.
  O corpo do `SKILL.md` só entra no contexto quando a skill é acionada.

### Divulgação progressiva (3 níveis)

| Nível | Conteúdo | Momento | Custo |
|---|---|---|---|
| L1 — Metadados | `name` + `description` | Sempre (startup), para todas as skills | ~100 tokens/skill |
| L2 — Instruções | Corpo do `SKILL.md` | Quando a skill é acionada | Manter enxuto (< 500 linhas) |
| L3 — Recursos | Arquivos em `references/`, `assets/`, `scripts/` | Quando referenciados no corpo | Sob demanda |

Os recursos L3 seguem a estrutura padrão da skill (opcionais): `references/` (documentação detalhada
lida sob demanda), `assets/` (templates e exemplos para cópia) e `scripts/` (código executável auxiliar).
O `SKILL.md` é o único arquivo obrigatório.

## A `description` decide o acionamento

A `description` é o texto que determina se a skill será carregada:

- **Limite absoluto: 1024 caracteres** (skills acima desse limite são rejeitadas);
- **Zona ideal: 300–500 caracteres** (1 a 3 frases densas).

### Estrutura: o que faz + quando usar + termos de gatilho

Coloque o caso de uso principal e os termos de busca no início (*front-loading*):

- **Skills técnicas/transversais**: ancore em **verbos** e ações reais das requisições ("Use ao
  escrever, editar ou revisar...").
- **Skills de domínio/negócio**: ancore no **vocabulário de negócio** do módulo ("Use ao trabalhar
  com sessões de agentes, reconexão ACP, mensagens do Discord...").
- Cite os gatilhos em texto corrido, sem listas e sem campos extras como `keywords`.

## Frontmatter: campos e regras

Mantenha o frontmatter estritamente enxuto:

- `name`: 1–64 caracteres, minúsculo, apenas `a-z 0-9 -`, sem hífen no início ou fim, sem `--`,
  **estritamente idêntico ao nome do diretório**.
- `description`: obrigatória, não vazia, seguindo as diretrizes de tamanho e gatilhos.

Não invente campos como `tags`, `version`, `category` ou `parameters` que apenas inflam o consumo
de tokens no L1.

## Skill ou instrução permanente (`AGENTS.md`)?

Nem toda regra deve virar skill:

- **Vira skill**: quando o procedimento é específico, aprofundado, só faz sentido "quando o
  assunto for X", ou traz exemplos e referências extensas.
- **Vira instrução em `AGENTS.md`**: quando a regra se aplica a praticamente qualquer tarefa
  (convenção de pastas, lint, política de commits, regra de comentários).

## Estrutura de arquivos

```text
.agents/skills/
  <slug>/
    SKILL.md            (obrigatório, sempre com este nome)
    references/         (opcional — documentação lida sob demanda)
    assets/             (opcional — templates e exemplos para cópia)
    scripts/            (opcional — utilitários executáveis)
```

- O slug utiliza kebab-case descritivo em inglês quando refletir termos técnicos do projeto;
- O arquivo principal chama-se invariavelmente `SKILL.md`.

## Tamanho do corpo e L2 → L3

O corpo do `SKILL.md` entra por inteiro no contexto quando acionado. Mantenha o corpo conciso:

- Trate **500 linhas** como gatilho de reflexão;
- Detalhes extensos, exemplos longos de configuração e tabelas exaustivas vão para `references/` (L3);
- A integridade da regra prevalece sobre o tamanho: nunca omita uma regra obrigatória para caber
  em 500 linhas. O que muda é onde ela reside (`SKILL.md` ou `references/`).
- Ao mover conteúdo para `references/`, mantenha um resumo no `SKILL.md` acompanhado do link relativo.

## Seções proibidas no corpo

- **Proibida seção "Quando usar" / "When to use"**: Essa informação pertence exclusivamente à
  `description` do frontmatter. Repetir no corpo é redundante.
- **Proibida meta-descrição do arquivo** ("Este arquivo descreve as regras..."): O corpo já é a
  autoridade prescritiva; não precisa se apresentar.

## Bloco de manutenção (anti-drift)

Logo após o título H1, insira a citação `> **Manutenção desta skill**`. Não enumere as regras
da skill no bloco; aponte para o documento inteiro ("qualquer regra descrita aqui") e destaque
o critério de comportamento vs. refatoração técnica.

## Não referenciar outra skill

Uma skill **não deve referenciar outra skill** por nome ou link ("veja a skill X"). Quem decide
o carregamento da skill complementar é o agente, avaliando a `description` de cada uma.
Cross-references criam acoplamento rígido e distorcem a prioridade de leitura. Descreva os
conceitos de forma autocontida ou utilize vocabulário neutro suficiente para que o agente acione
a outra skill autonomamente. Links internos dentro da mesma skill (`SKILL.md` ↔ `references/`)
são permitidos e encorajados.

## Tom e escrita

- Tom **prescritivo e declarativo**: "deve", "não deve", "utilize X ao...".
- **Estado atual, nunca a transição**: Descreva a regra consolidada para um leitor que não viu
  as versões anteriores. Proibido narrar histórico ("agora faz", "não usa mais").
- Negações apenas quando guardam um erro plausível que um desenvolvedor competente cometeria.

## Checklist

- [ ] `name` em minúsculo com hífens, idêntico ao nome da pasta da skill.
- [ ] `description` entre 300–500 caracteres, com caso de uso e gatilhos no início.
- [ ] Bloco `> **Manutenção desta skill**` imediatamente após o H1, sem listar regras.
- [ ] Nenhuma seção "Quando usar" e nenhuma meta-descrição no corpo.
- [ ] Nenhuma referência direta a outra skill por nome ou caminho.
- [ ] Detalhes pesados transferidos para `references/` se o corpo atingir 500 linhas.
- [ ] Texto focado no estado atual do sistema, sem narrar histórico ou transição.
