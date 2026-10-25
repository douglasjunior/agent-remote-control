---
name: skill-authoring
description: >
  Standard for creating, reviewing, updating or splitting any skill (domain or
  technical) in .agents/skills/. Defines agent discovery through name and description,
  3-level progressive disclosure, line limits and use of references/, forbidden
  sections, English-only writing and anti-drift maintenance. Use when writing, editing,
  reviewing or organizing any SKILL.md in the project.
---

# Skill authoring

> **Maintaining this skill**
>
> Update this document whenever **any rule described here** changes. The criterion is not
> *which* rule — it is the nature of the change: the skill authoring standard changed →
> update; a cosmetic tweak to a specific skill that preserves the standard → leave it alone.

These rules apply to **any** skill in the repository — business domain or
technical/cross-cutting — both when **creating** and when **updating** a skill. A skill is
loaded on demand; every authoring decision aims to **spend the least context** of the
session window for the greatest usefulness.

## What a skill is (and what it is not)

A skill lives in `.agents/skills/<slug>/SKILL.md` and is the authoritative source of the
durable decisions about a scope. It is **prescriptive**: it defines what **must** and what
**must not** be done, not merely what exists.

Do not create a skill whose sole purpose already belongs to another channel: standalone API
documentation (belongs to OpenAPI or contract tests), a class comment (belongs to the code),
a one-off decision (belongs to the commit/PR) or a step-by-step introductory tutorial. The
goal is to avoid turning merely descriptive reference material, with no prescriptive rule of
its own, into a skill.

## How the agent discovers and loads skills

The discovery mechanism defines the skill's structure:

- **There is no vector search at runtime.** The agent loads the `name` and `description` of
  **all** skills as static text in the system prompt and decides whether to trigger them by
  reading that text.
- **It uses the literal text.** The `description` is not summarized before reaching the model.
  What is written determines loading.
- **Fixed cost per skill (~100 tokens: `name` + `description`)**, always present in the
  session. The `SKILL.md` body only enters the context when the skill is triggered.

### Progressive disclosure (3 levels)

| Level | Content | When | Cost |
|---|---|---|---|
| L1 — Metadata | `name` + `description` | Always (startup), for every skill | ~100 tokens/skill |
| L2 — Instructions | `SKILL.md` body | When the skill is triggered | Keep it lean (< 500 lines) |
| L3 — Resources | Files in `references/`, `assets/`, `scripts/` | When referenced in the body | On demand |

L3 resources follow the standard skill structure (optional): `references/` (detailed
documentation read on demand), `assets/` (templates and examples to copy) and `scripts/`
(auxiliary executable code). `SKILL.md` is the only mandatory file.

## The `description` decides triggering

The `description` is the text that determines whether the skill will be loaded:

- **Hard limit: 1024 characters** (skills above this limit are rejected);
- **Ideal range: 300–500 characters** (1 to 3 dense sentences).

### Structure: what it does + when to use it + trigger terms

Put the main use case and the search terms first (*front-loading*):

- **Technical/cross-cutting skills**: anchor on **verbs** and the real actions of requests
  ("Use when writing, editing or reviewing...").
- **Domain/business skills**: anchor on the module's **business vocabulary** ("Use when working
  with agent sessions, ACP reconnection, Discord messages...").
- Mention the triggers in running text, without lists and without extra fields such as
  `keywords`.

## Frontmatter: fields and rules

Keep the frontmatter strictly lean:

- `name`: 1–64 characters, lowercase, only `a-z 0-9 -`, no leading or trailing hyphen, no
  `--`, **strictly identical to the directory name**.
- `description`: mandatory, non-empty, following the size and trigger guidelines.

Do not invent fields such as `tags`, `version`, `category` or `parameters` that only inflate
L1 token consumption.

## Skill or permanent instruction (`AGENTS.md`)?

Not every rule should become a skill:

- **Becomes a skill**: when the procedure is specific, in-depth, only makes sense "when the
  subject is X", or carries extensive examples and references.
- **Becomes an instruction in `AGENTS.md`**: when the rule applies to virtually any task
  (folder conventions, lint, commit policy, comment rules).

## File structure

```text
.agents/skills/
  <slug>/
    SKILL.md            (mandatory, always with this name)
    references/         (optional — documentation read on demand)
    assets/             (optional — templates and examples to copy)
    scripts/            (optional — executable utilities)
```

- The slug uses descriptive kebab-case in English;
- The main file is always named `SKILL.md`.

## Body size and L2 → L3

The `SKILL.md` body enters the context in full when triggered. Keep the body concise:

- Treat **500 lines** as a trigger for reflection;
- Extensive details, long configuration examples and exhaustive tables go to `references/` (L3);
- Rule integrity prevails over size: never omit a mandatory rule to fit within 500 lines. What
  changes is where it lives (`SKILL.md` or `references/`).
- When moving content to `references/`, keep a summary in `SKILL.md` along with the relative
  link.

## Forbidden sections in the body

- **No "When to use" section**: This information belongs exclusively to the frontmatter
  `description`. Repeating it in the body is redundant.
- **No meta-description of the file** ("This file describes the rules..."): The body is
  already the prescriptive authority; it does not need to introduce itself.

## Maintenance block (anti-drift)

Right after the H1 title, insert the `> **Maintaining this skill**` quote. Do not enumerate
the skill's rules in the block; point to the whole document ("any rule described here") and
highlight the criterion of behavior change vs. technical refactor.

## Do not reference another skill

A skill **must not reference another skill** by name or link ("see skill X"). The agent
decides whether to load the complementary skill by evaluating each one's `description`.
Cross-references create rigid coupling and distort reading priority. Describe the concepts in
a self-contained way or use neutral vocabulary sufficient for the agent to trigger the other
skill on its own. Internal links within the same skill (`SKILL.md` ↔ `references/`) are
allowed and encouraged.

## Tone and writing

- Skills are written in **English**: frontmatter, body, examples and references.
- **Prescriptive and declarative** tone: "must", "must not", "use X when...".
- **Current state, never the transition**: Describe the consolidated rule for a reader who has
  not seen previous versions. Narrating history ("now does", "no longer uses") is forbidden.
- Negations only when they guard against a plausible mistake a competent developer would
  make.

## Checklist

- [ ] `name` in lowercase with hyphens, identical to the skill's folder name.
- [ ] `description` between 300–500 characters, with use case and triggers first.
- [ ] `> **Maintaining this skill**` block immediately after the H1, without listing rules.
- [ ] No "When to use" section and no meta-description in the body.
- [ ] No direct reference to another skill by name or path.
- [ ] Heavy details moved to `references/` if the body reaches 500 lines.
- [ ] Written in English.
- [ ] Text focused on the current state of the system, without narrating history or transition.
