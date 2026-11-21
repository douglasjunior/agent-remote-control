import { describe, expect, it } from '@rstest/core';

import { DEVELOPER_ARTIFACT_ACCESS } from '../constants/artifact-access.constant.js';
import { SKILL_NAMES } from '../constants/skill-names.constant.js';

import { buildArtifactProtocolBrief } from './artifact-protocol.prompt.js';
import { CWD_BOUNDARY_INSTRUCTIONS } from './cwd-boundary.prompt.js';
import { buildDeveloperReentryNote, buildDeveloperSystemPrompt } from './developer.prompt.js';
import { FINAL_RESPONSE_INSTRUCTIONS } from './final-response.prompt.js';
import { PROJECT_ORIENTATION_INSTRUCTIONS } from './project-orientation.prompt.js';


const DEVELOPER_SYSTEM_PROMPT = buildDeveloperSystemPrompt('tags');
const DEVELOPER_REENTRY_NOTE = buildDeveloperReentryNote('tags');

describe('developer.prompt', () => {
  it('should define the developer as the agent that takes one task to work ready for review', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('You are the Developer Agent');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('The task opens your prompt in a `[DELEGATED_ARTIFACT]` block');
  });

  it('should make the notes it records part of the deliverable for the reviewer and the tester', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('a reviewer with no memory of this session judges the branch against the task, and a tester runs it');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('those notes are part of the deliverable');
  });

  it('should fix the findings of the review or the test report when the task comes back', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('fix the findings in its `review_findings` or `test_report` section');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('append what you fixed and how (`mode="append"`)');
  });

  describe('checks', () => {
    it('should run the checks non-interactively and wait for them before it finishes', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('### Checks');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('never in watch or interactive mode (set `CI=1`');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Work whose checks you did not see pass is not done.');
    });

    it('should find the checks once per task before the first edit and record them for whoever comes next', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('**Before your first edit, find the checks, once per task.**');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('already have a `Checks:` line, use it and skip this step');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('the CI workflows (`.github/workflows`), which show what a pull request must pass');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('know its command for one file and for one package, and write them in a `Checks:` line of the notes you record with your answer');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain(`The \`${SKILL_NAMES.runningChecks}\` skill has the commands of each ecosystem.`);
    });

    it('should check only the files it changes while it works', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('**While you work, check only the files you change.**');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('A type check that cannot be scoped to a file (`tsc`) runs on the package, and only before a commit.');
    });

    it('should run the full checks of the affected packages only, before the verdict', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('**Before your verdict, run the full checks of each affected package, once.**');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Run the checks of the whole repository only when it has no packages or you changed its shared root configuration');
    });

    it('should fix failures without weakening the checks and prove the unrelated ones pre-existing', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('re-run only what failed, then step 3 again');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Never skip or disable a test or a lint rule, nor lower a coverage threshold');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('run only that test on the base branch');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('`DONE` requires step 3 to pass, or its failures proven pre-existing and recorded in your notes.');
    });
  });

  it('should use the commands the project documents for itself', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('Use the commands the project documents for itself');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('rather than reproducing their steps');
  });

  it('should bring the decisions the user must make back to the caller instead of asking', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('<question');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('You do not ask the user yourself');
    expect(DEVELOPER_SYSTEM_PROMPT).toContain('put the conflict and its options in your final answer');
  });

  describe('git', () => {
    it('should work on the branch of the task, naming a new one after the project convention', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('work on the branch of the task');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('`<type>/<task id>-<short-slug>`');
    });

    it('should work in each git repository of its project the task needs, with a pull request recorded for each', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Your project folder may hold several git repositories (nested clones): work in whichever the task needs. In each, work on the branch of the task');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('the same name in every repository');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('In each repository with a remote, push the branch of the task and open its pull request');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('recording each with its `repository`');
    });

    it('should answer INCOMPLETE when the named base branch is missing instead of creating it', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('A named base the repository lacks (a feature branch) is created by whoever the workflow says, not by you: answer `INCOMPLETE` naming that step.');
    });

    it('should commit in atomic commits that follow the project convention, keeping secrets out', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('atomic commits that follow the project\'s commit convention');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Conventional Commits in English');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('keep credentials, keys and `.env` files out of commits');
    });

    it('should push the branch and open or update the pull request through the git-remote skill', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('push the branch of the task and open its pull request, or update the one already linked on the task');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain(`The \`${SKILL_NAMES.gitRemote}\` skill has the procedure`);
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('Without a remote the branch stays local');
    });

    it('should change no branch but its own and leave the rest to another agent without naming it', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('In each repository the branch of the task is the only one you change.');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('force pushes, deleting remote refs, cloning and remote configuration belong to another agent');
      expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('GIT_OPS');
      expect(DEVELOPER_SYSTEM_PROMPT).not.toContain('ssh-keygen');
    });
  });

  describe('verdict', () => {
    it('should record the branch, the notes and the pull request on the task together with the answer', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('<artifact_update id="T-3" branch="feat/t-3-login-api"><section name="implementation_notes">Markdown</section><pull_request url="https://..." title="T-3: Login API" state="open"/></artifact_update>');
    });

    it('should keep the verdict DONE when only the pull request cannot be opened', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('A pull request that cannot be opened (no hosting provider, no tooling for it) does not make the work incomplete');
    });

    it('should start the answer with DONE or INCOMPLETE on a line of its own', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('starting with the verdict on a line of its own');
      expect(DEVELOPER_SYSTEM_PROMPT).toMatch(/starting with the verdict on a line of its own, written exactly as shown (here|above), in English whatever the language of the rest/);
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('`DONE`: everything the task asks is committed, pushed when there is a remote, and its checks passed.');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('`INCOMPLETE`: only when something outside your reach stops you');
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('work you can still do yourself is not a reason to stop');
    });

    it('should keep the answer short because the details are on the task', () => {
      expect(DEVELOPER_SYSTEM_PROMPT).toContain('The details are in the notes, so do not repeat them.');
    });
  });

  it('should include the board brief of its access and the shared blocks', () => {
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS, 'tags'));
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(PROJECT_ORIENTATION_INSTRUCTIONS);
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(CWD_BOUNDARY_INSTRUCTIONS);
    expect(DEVELOPER_SYSTEM_PROMPT).toContain(FINAL_RESPONSE_INSTRUCTIONS);
  });

  describe('re-entry note', () => {
    it('should send the developer back to its role guide', () => {
      expect(DEVELOPER_REENTRY_NOTE.startsWith('[RE-ENTRY]')).toBe(true);
      expect(DEVELOPER_REENTRY_NOTE).toContain('a session you started as the Developer Agent');
      expect(DEVELOPER_REENTRY_NOTE).toContain(`<skill_read name="${SKILL_NAMES.roleGuide}"/>`);
    });

    it('should carry the checks, the push and the record with the verdict words', () => {
      expect(DEVELOPER_REENTRY_NOTE).toContain('finish it in this turn on its branch, then push and update its pull request, stopping early only for a blocker outside your reach');
      expect(DEVELOPER_REENTRY_NOTE).toContain('Run the checks of the files you change while you work, and the full checks of the affected packages before the verdict; the commands are in the `Checks:` line of the notes.');
      expect(DEVELOPER_REENTRY_NOTE).toContain('Record the branch, the pull request and the implementation notes on the task');
      expect(DEVELOPER_REENTRY_NOTE).toContain('written exactly as shown, in English: DONE or INCOMPLETE');
    });
  });

  describe('on the tools interface', () => {
    const prompt = buildDeveloperSystemPrompt('tools');
    const note = buildDeveloperReentryNote('tools');

    it('should keep every passage that does not depend on the interface', () => {
      expect(prompt).toContain('### How Your Work Is Used');
      expect(prompt).toContain('Work whose checks you did not see pass is not done.');
      expect(prompt).toContain('In each repository the branch of the task is the only one you change.');
      expect(prompt).toContain(buildArtifactProtocolBrief(DEVELOPER_ARTIFACT_ACCESS, 'tools'));
      expect(prompt).toContain(FINAL_RESPONSE_INSTRUCTIONS);
    });

    it('should record the branch, the pull request and the notes with artifact_update before the answer', () => {
      expect(prompt).toContain('1. Record the work on the task with `artifact_update` before you answer: the branch, the pull request');
      expect(prompt).toContain('the `implementation_notes` section. The notes say what you changed and why');
      expect(prompt).toContain('append what you fixed and how rather than replacing the notes');
      expect(prompt).not.toContain('<artifact_');
    });

    it('should open the answer with the verdict that follows the record', () => {
      expect(prompt).toContain('2. Then write your answer to the coordinator, starting with the verdict on a line of its own, written exactly as shown here, in English');
      expect(prompt).toContain('`DONE`: everything the task asks is committed');
    });

    it('should record the checks at once with artifact_update and keep them in the final notes', () => {
      expect(prompt).toContain('### Checks');
      expect(prompt).toContain('record them at once in a `Checks:` line of the task\'s `implementation_notes` with `artifact_update`');
      expect(prompt).toContain('keep that line in the notes you record at the end.');
      expect(prompt).toContain('**Before your verdict, run the full checks of each affected package, once.**');
    });

    it('should name the tools in the re-entry note with the verdict words', () => {
      expect(note).toContain('the tools of the `arc` MCP server');
      expect(note).toContain('on the task with `artifact_update`, then write your answer');
      expect(note).toContain('the commands are in the `Checks:` line of the notes');
      expect(note).toContain('written exactly as shown, in English: DONE or INCOMPLETE');
      expect(note).not.toContain('<skill_read');
    });
  });
});
