import { describe, expect, it } from '@rstest/core';

import { UX_DESIGNER_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS } from './project-orientation.prompt.js';
import { USER_QUESTIONS_BRIEF } from './user-questions.prompt.js';
import { buildUxDesignerReentryNote, buildUxDesignerSystemPrompt } from './ux-designer.prompt.js';


const UX_DESIGNER_SYSTEM_PROMPT = buildUxDesignerSystemPrompt('tags');
const UX_DESIGNER_REENTRY_NOTE = buildUxDesignerReentryNote('tags');

describe('ux-designer.prompt', () => {
  it('should define the designer as the agent that decides how the work looks and behaves, without implementing it', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('You are the UX/UI Designer Agent');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('to decide how it looks, reads and behaves');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('The production code, its data, its API and its tests are built after you, so you do not implement them.');
  });

  it('should read the product sections, the existing design system and the running app before designing', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('### Context First');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('shadcn\'s `components.json`');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('CSS custom properties and token files');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain(`Run the app as it is today and look at the screens next to the work (the \`${SKILL_NAMES.runningTheApp}\` skill has how)`);
  });

  it('should pick a fast or a robust regime and name it', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('choose one of two regimes, and name it in the `ux_design` section and in your final answer');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('**Fast and assertive**');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('Ask at most one round of visual-direction questions');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('**Robust and impressive**');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('every state of every screen: empty, loading, error, success, partial and no permission');
  });

  it('should read facts instead of asking them and confirm the decisions with the prototype', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('What the artifact, the design system or the running app answers is a fact to read, never a question');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('give in the rationale the design reason behind your recommendation');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('The prototype is the summary the user confirms');
  });

  it('should put the user first, then the project\'s design system, with real content and no template marks', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('Precedence: the user\'s words, then the project\'s design system, then your own taste.');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('Never lorem ipsum');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('a purple-to-blue gradient hero');
  });

  it('should send the designer to each design skill when the work touches it', () => {
    for (const name of [
      SKILL_NAMES.visualFoundations,
      SKILL_NAMES.layoutComposition,
      SKILL_NAMES.designSystems,
      SKILL_NAMES.interactionStates,
      SKILL_NAMES.responsiveMobile,
      SKILL_NAMES.accessibility,
      SKILL_NAMES.uxWriting,
      SKILL_NAMES.motion,
      SKILL_NAMES.dataVisualization,
      SKILL_NAMES.prototyping,
      SKILL_NAMES.visualPolish,
    ]) {
      expect(UX_DESIGNER_SYSTEM_PROMPT).toContain(`\`${name}\``);
    }
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain(`the \`${SKILL_NAMES.visualPolish}\` skill has the full checklist`);
  });

  it('should keep the prototype on a design branch that is never merged and leave the folder as found', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('`design/<artifact id>-<slug>` (for example `design/t-3-checkout`)');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('In an existing project, build it in the project\'s own stack');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('build it in a `prototype/` folder at the project root, on the same kind of branch: a self-contained HTML prototype that opens straight from disk in the fast regime, a small React app with Vite and shadcn/ui in the robust one');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('The branch is never merged and stays local unless the user asks for it to be pushed');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('switch back to the branch that was checked out');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('You build a prototype only in a project folder you may change');
  });

  it('should look at the prototype at phone and desktop widths before delivering', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('look at it at a phone width (390 px) and a desktop width (1440 px), in light and dark');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('Fix what you see and look again.');
  });

  it('should record the design in ux_design and settle the design refinement', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('The `ux_design` section of each artifact you designed holds');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('the prototype branch and exactly how to open it');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('<artifact_update id="T-3" design_refinement="done"><section name="ux_design">Markdown</section></artifact_update>');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('Leave the other refinements as they are.');
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain('Your final answer gives the regime you chose');
  });

  it('should include the board brief of its access and the shared blocks', () => {
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(UX_DESIGNER_ARTIFACT_ACCESS, 'tags'));
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain(USER_QUESTIONS_BRIEF);
    expect(UX_DESIGNER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the designer back to its role guide with the branch and review rules', () => {
      expect(UX_DESIGNER_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(UX_DESIGNER_REENTRY_NOTE).toContain('a session you started as the UX/UI Designer Agent');
      expect(UX_DESIGNER_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
      expect(UX_DESIGNER_REENTRY_NOTE).toContain('the branch is never merged, and you do not implement the feature');
      expect(UX_DESIGNER_REENTRY_NOTE).toContain('set `design_refinement="done"`');
    });
  });

  describe('on the tools interface', () => {
    const prompt = buildUxDesignerSystemPrompt('tools');

    it('should keep every passage that does not depend on the interface and record with the tool', () => {
      expect(prompt).toContain('### Pick a Regime, and Say Which');
      expect(prompt).toContain('Write the `ux_design` section and set `design_refinement="done"` with one `artifact_update` per artifact you designed, before your final answer.');
      expect(prompt).toContain(buildArtifactProtocolBrief(UX_DESIGNER_ARTIFACT_ACCESS, 'tools'));
      expect(prompt).not.toContain('<artifact_');
    });

    it('should name the tools in the re-entry note', () => {
      expect(buildUxDesignerReentryNote('tools')).toContain('the tools of the `arc` MCP server');
    });
  });
});
