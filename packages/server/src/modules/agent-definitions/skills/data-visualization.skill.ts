import { SKILL_NAMES } from '../constants/skill-names.constant.js';
import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';


export const DATA_VISUALIZATION_SKILL: AgentSkillDefinition = {
  name: SKILL_NAMES.dataVisualization,
  description: 'Read before designing any chart, graph, stat tile, KPI row, sparkline or dashboard widget: picking the chart from the question it answers, axes and ticks on one scale, categorical, sequential and diverging palettes, legends versus direct labels, when big numbers earn their place, and chart text that follows the theme.',
  roles: ['UX_DESIGNER'],
  buildContent: () => `# Data Visualization

## Start From the Question
Write the question the chart answers before choosing it ("Which region fell behind its target this quarter?"). The question picks the form:
- Change over time: a line chart (continuous), columns for a few discrete periods (up to about 12). An area chart only when the total under the line means something.
- Comparison between categories: horizontal bars sorted by value, which leave room for long labels. Not a pie.
- Part of a whole: a single stacked bar or a 100 percent bar; a pie or donut only for two or three parts where one dominates. Never a pie with seven slices or a 3D anything.
- Distribution: a histogram or a box plot; a strip or beeswarm for small samples.
- Relationship between two measures: a scatter plot, with a trend line only when the relationship is the message.
- Progress to a target: a bar with a target marker or a bullet chart; a gauge only on a screen that is about that single value.
- Exact values to look up: a table, not a chart. Many charts should have been a sorted table with one highlighted column.

## Marks, Axes and Ticks
- One scale for marks and ticks: the axis is derived from the same scale function that positions the marks, so a tick at 40 sits exactly where a mark of 40 sits. Never place ticks or gridlines by a separate guess.
- Bars start at zero; lines may zoom to the data's range when the change is the point, with the axis clearly labeled.
- Ticks at round values within the range the data actually reaches (0, 25, 50, 75, 100), four to six of them; no tick labels beyond the data with nothing to show. Format them like the data (\`1.2k\`, \`$40\`, \`Mar 12\`), with units once in the axis title.
- Gridlines faint (border token at low contrast) and horizontal only for bar and line charts; no chart borders, no background boxes, no drop shadows on marks.
- Dates on a time axis use real time spacing; missing periods show as gaps, not as interpolated lines.

## Color
- Categorical palette for distinct series: up to 6 to 8 hues of similar lightness and chroma (OKLCH helps), distinguishable for color-blind readers (avoid red against green as the only difference). Beyond 6 series, highlight the two that matter and gray the rest.
- Sequential palette (one hue, light to dark) for ordered magnitude: heatmaps, choropleths, density.
- Diverging palette (two hues meeting at a neutral midpoint) for values around a meaningful center: change versus last period, above or below target. The midpoint is the real zero or target, not the data's mean.
- Semantic colors keep their meaning: red for bad, green for good, only when the direction of good is unambiguous; in finance, respect the market's convention.
- Highlight with color, mute with gray: the series the question is about gets the accent, the context gets neutral tones.
- Every palette is defined per theme and checked in both: marks need 3:1 against the background.

## Labels and Legends
- Label directly when possible: the series name at the end of its line, the value at the end of its bar. A legend forces eye travel; use one only when direct labels collide, placed above the chart in the same order as the series.
- Title states the takeaway or the question ("Signups doubled after the March launch"), with a subtitle for the measure, unit and period.
- Tooltips show the exact value, the series and the date, formatted; they never hold information the chart needs to be understood. Charts work without hover on touch devices.
- Annotate the event that explains a change (a launch, an outage) right on the chart.

## Stat Tiles and KPI Rows
- Big numbers earn their place only when the number itself is the point and someone acts on it. A row of four tiles with vanity counts is decoration; prefer one sentence or a table.
- A tile holds the label (what, over which period), the value (large, tabular figures, with unit), and context: the change versus a comparable period with its direction and sign, and whether that is good. A number without a comparison cannot be judged.
- Keep tiles the same size and structure; three to five per row; never stretch one tile across the screen.
- Sparklines: a small line without axes showing the trend behind a number, same time range across tiles, with the latest point marked. They suggest a shape; they do not replace a chart.

## Theme and Implementation
- Chart text, axes and gridlines use the theme's tokens (\`--muted\` for ticks, \`--fg\` for labels, \`--border\` for grids), read at render time, so the chart follows light and dark. Never hard-code \`#333\` or white in chart options.
- Charts keep their aspect on resize (a responsive container) and simplify on a phone: fewer ticks, labels rotated never more than 45 degrees (prefer fewer labels), legend below.
- Provide the data behind the chart in an accessible form (a table toggle or a visually hidden table) and an \`aria-label\` summarizing the takeaway.
- Use the project's chart library; otherwise a mature one (Recharts or visx for React, Chart.js, ECharts, Observable Plot) over hand-built SVG, except for sparklines and simple bars.`,
};
