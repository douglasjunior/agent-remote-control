---
name: shadcn-ui
description: >
  How to use the shadcn CLI in packages/web: searching and installing components, the preset
  and style in components.json, the vendored components/ui folder, and the rule to look for a
  shadcn component before writing one. Covers keeping relative imports instead of the @/* alias
  after every CLI run. Use when adding, updating or searching UI components, buttons, dialogs,
  sheets, inputs or when styling the web interface.
---

# shadcn/ui

> **Maintaining this skill**
>
> Update this document whenever the shadcn setup changes: preset, style, aliases, scripts or the
> import workaround. A visual tweak to a single component leaves it untouched.

## Rule: shadcn first

Before writing any UI component, **search shadcn for it**. Only build a component of our own when shadcn
has no suitable one, and then compose it from shadcn primitives (`Button`, `Card`, `Badge`, ...) found in
`src/components/ui/`. Never reimplement what the registry offers (dialog, sheet, select, tabs, input,
dropdown, tooltip, skeleton, ...).

```bash
cd packages/web
npx shadcn@latest search @shadcn -q button   # search the registry (the @shadcn namespace is required)
npx shadcn@latest view card             # show a component's source and dependencies before installing
```

## Setup

- `components.json` records the project setup. It was created with
  `npx shadcn@latest init --preset b6XG5WQ02q`: style `base-nova` (built on `@base-ui/react`, **not** Radix),
  base color `mist`, Lucide icons, Instrument Sans and Space Grotesk fonts. Keep that preset; do not
  re-run `init` with another one.
- Theme tokens (`--primary`, `--muted`, ...) live in `src/index.css`. Style through these tokens and
  Tailwind utilities, never with hard-coded colors.
- `src/lib/utils.ts` re-exports `cn` from the `cn` package; components import `cn` from it.

## Installing and updating components

```bash
cd packages/web
pnpm ui:add <component> [<component> ...]     # = npx shadcn add; add --overwrite to update one
pnpm ui:relativize                             # mandatory right after every CLI run
pnpm lint:fix                                  # from the repository root: formats the generated code
```

The files land in `src/components/ui/` as vendored source. They are excluded from coverage, and
`react-refresh/only-export-components` is off for that folder only (generated files export variants
next to components). Change a vendored file only when the app cannot do without it; prefer composing it.
Components built on Base UI use `render` props instead of Radix `asChild`, and Base UI parts have their
own names (for example `Collapsible.Panel`): read the generated file before using a component.

## The `@/*` alias and relative imports

The CLI refuses to run without a path alias and writes `@/components/...` imports, while this repository
uses relative imports with the `.js` suffix (see `web-app`). The workaround has two parts:

1. `tsconfig.json` keeps `"paths": { "@/*": ["./src/*"] }` **only so the CLI can validate the project**.
   Application code never uses the alias, and `components.json` keeps its `@/` aliases for the same reason.
2. `pnpm ui:relativize` (`scripts/relativize-imports.mjs`) rewrites every `@/x` import under `src/` to a
   relative path ending in `.js`. Run it after every `init`, `add` or `--overwrite`, then `pnpm lint:fix`.

An `@/` import left in `src/` is a defect: it type-checks through `paths` but breaks the convention.
Check with `grep -rn "from [\"']@/" packages/web/src`.

## Checklist for a new UI piece

1. `npx shadcn@latest search @shadcn -q <name>`: is there a component for it?
2. Yes: `pnpm ui:add <name>`, `pnpm ui:relativize`, `pnpm lint:fix`, then use it.
3. No: compose it in `src/components/` from the vendored primitives, with a spec file next to it.
