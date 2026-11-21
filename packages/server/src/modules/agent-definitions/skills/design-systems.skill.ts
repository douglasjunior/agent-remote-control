import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const DESIGN_SYSTEMS_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.designSystems,
  description: 'Read before adding a color, size, token or component to a project, and when a project has no design system yet: detecting and reusing what exists (Tailwind theme, shadcn with Radix or Base UI, MUI, Chakra, CSS variables), mapping new needs onto existing tokens, creating a minimal token set and component inventory, naming, and recording the decisions.',
  roles: ['UX_DESIGNER'],
  buildContent: () => `# Design Systems

## Detect What Exists
Look before you add. In order:
- **Tailwind**: \`tailwind.config.*\` (v3, \`theme.extend\`) or the CSS-first \`@theme\` block in the main stylesheet (v4); the custom colors, fonts, radii and spacing there are the system. Note the version: utilities and configuration differ.
- **shadcn/ui**: \`components.json\` (style, base color, CSS variables, aliases, icon library), the \`components/ui\` folder, and the CSS variables in the global stylesheet (\`--background\`, \`--foreground\`, \`--primary\`, \`--muted\`, \`--accent\`, \`--destructive\`, \`--border\`, \`--ring\`, \`--radius\`, \`--chart-1..5\`, often in OKLCH). Its primitives come from Radix or Base UI. Add components with the project's shadcn CLI rather than writing them.
- **MUI**: \`createTheme\` (palette, typography, shape, spacing, components overrides) and \`sx\` usage; **Chakra**: the theme or system config with semantic tokens; **Mantine**: \`createTheme\`; **Ant Design**: \`ConfigProvider\` tokens; **Bootstrap**: Sass variables.
- **Plain CSS**: custom properties on \`:root\` and theme selectors, token files (\`tokens.json\`, Style Dictionary, Figma exports), CSS modules with shared variables.
- **Native and mobile**: the React Native theme object, Flutter \`ThemeData\`, SwiftUI asset catalogs and Android \`colors.xml\`/Material theme.
- Then the components in use: list the existing buttons, inputs, selects, dialogs, tables, cards, badges, toasts and their variants. Grep for hard-coded colors and pixel values to see where the system leaks.

## Reuse and Extend
- Map every new need onto an existing token or component first: a "subtle panel" is the existing \`--muted\` surface; a "warning chip" is the existing badge with the warning variant. Only when nothing fits do you add.
- When you add, extend the system in its own idiom: a new variant on the existing component (\`variant="warning"\`), a new semantic token next to the others with values for every theme, a new component built from the same primitives and tokens. Never a parallel one-off with its own colors.
- Keep the project's conventions for naming, file placement and API shape (props names, \`asChild\`, \`size\` scale). A design that ignores them costs the developer a rewrite.
- A change to a shared token changes every screen: say so in the design record, and prefer adding a token to repurposing one.

## When There Is No System
Create the smallest one that covers the work, as CSS custom properties (and the matching Tailwind theme when Tailwind is used):
- **Color**: \`--bg\`, \`--surface\`, \`--surface-raised\`, \`--fg\`, \`--muted\`, \`--border\`, \`--accent\`, \`--accent-fg\`, \`--ring\`, \`--good\`, \`--warn\`, \`--critical\`, each with a dark value. Derive them from one neutral ramp and one accent ramp in OKLCH.
- **Type**: one or two families, a scale of five or six sizes (\`--text-xs\` to \`--text-2xl\`), two or three weights, line heights per size.
- **Space**: the 4/8 scale. **Radius**: two or three values by role. **Elevation**: three shadows. **Motion**: two or three durations and two easings.
- **Components**: the inventory the work needs and nothing more, usually button (primary, secondary, ghost, destructive; sm, md, lg), input, select, checkbox, switch, textarea, label with helper and error, card, badge, dialog or sheet, toast, table, tabs, empty state, skeleton. Each with its states: default, hover, active, focus-visible, disabled, loading, error.
- In a React project without a library, start from shadcn/ui on Radix or Base UI rather than hand-rolling accessible primitives.

## Naming
- Tokens are named by role and scale, never by value or hue: \`--accent\`, \`--critical\`, \`--space-4\`, \`--radius-card\`; not \`--blue-500\` in components (ramps exist underneath, components use roles).
- Two layers: primitive tokens (the ramps: \`--gray-1..12\`, \`--brand-1..12\`) and semantic tokens (\`--surface\`, \`--fg\`) pointing at them; themes swap the semantic layer.
- Component variants named by intent (\`destructive\`, \`subtle\`), sizes by a shared scale (\`sm md lg\`).

## Record the Decisions
In the \`ux_design\` section: the tokens used and added with their values per theme, the components reused, the variants or components added and why nothing existing fitted, and every place the design departs from the system on purpose. The developer must be able to implement the design without opening the prototype's styles.`,
};
