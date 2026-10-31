import { describe, expect, it } from 'vitest';

import type { AgentActivity } from '../../agent/ports/agent.port.js';
import type { AgentConfigSelection } from '../../orchestrator/models/agent-config-selection.model.js';
import type { AgentProfileSettings, AgentSettings } from '../../orchestrator/models/agent-settings.model.js';
import type { QuestionPrompt } from '../../orchestrator/models/user-question.model.js';

import { DiscordActivityFormatter } from './discord-activity.formatter.js';


describe('DiscordActivityFormatter', () => {
  const formatter = new DiscordActivityFormatter();

  describe('formatActivity', () => {
    it('should format single-line thought activity as a blockquote with emoji', () => {
      const activity: AgentActivity = {
        kind: 'thought',
        id: '1',
        text: 'Analyzing project structure...',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('> 💭 *Analyzing project structure...*');
    });

    it('should format multi-line thought activity preserving lines in blockquote', () => {
      const activity: AgentActivity = {
        kind: 'thought',
        id: '2',
        text: 'First step.\nSecond step.',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('> 💭 *First step.*\n> *Second step.*');
    });

    it('should return null for empty or whitespace-only thought', () => {
      const activity: AgentActivity = {
        kind: 'thought',
        id: '3',
        text: '   \n  ',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBeNull();
    });

    it('should format tool in_progress status', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-1',
        title: 'git status',
        status: 'in_progress',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('⏳ **Running**: `git status`');
    });

    it('should format tool completed status', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-2',
        title: 'git diff',
        status: 'completed',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('✅ **Completed**: `git diff`');
    });

    it('should format tool failed status', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-3',
        title: 'git push',
        status: 'failed',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('❌ **Failed**: `git push`');
    });

    it('should format tool completed status with up to 5 lines of details in a code block', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-2',
        title: 'git diff',
        status: 'completed',
        details: 'line 1\nline 2\nline 3',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('✅ **Completed**: `git diff`\n```\nline 1\nline 2\nline 3\n```');
    });

    it('should format tool completed status with more than 5 lines truncating with ... (+N lines)', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-2',
        title: 'git status',
        status: 'completed',
        details: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe(
        '✅ **Completed**: `git status`\n```\nl1\nl2\nl3\nl4\nl5\n... (+3 lines)\n```',
      );
    });

    it('should truncate single-line details exceeding max length with ellipsis', () => {
      const longText = 'x'.repeat(2500);
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-long',
        title: 'git diff',
        status: 'completed',
        details: longText,
      };

      const result = formatter.formatActivity(activity);

      const expectedContent = `${'x'.repeat(1797)}...`;
      expect(result).toBe(`✅ **Completed**: \`git diff\`\n\`\`\`\n${expectedContent}\n\`\`\``);
      expect(result!.length).toBeLessThanOrEqual(2000);
    });

    it('should truncate when first 5 lines exceed max length while preserving line suffix', () => {
      const longLines = [
        'a'.repeat(400),
        'b'.repeat(400),
        'c'.repeat(400),
        'd'.repeat(400),
        'e'.repeat(400),
        'f',
        'g',
        'h',
      ].join('\n');
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-multi-long',
        title: 'git status',
        status: 'completed',
        details: longLines,
      };

      const result = formatter.formatActivity(activity);

      expect(result).toContain('... (+3 lines)\n```');
      expect(result).toContain('...');
      expect(result!.length).toBeLessThanOrEqual(2000);
    });

    it('should format tool failed status with details in a code block', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-3',
        title: 'build',
        status: 'failed',
        details: 'error line 1\nerror line 2',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('❌ **Failed**: `build`\n```\nerror line 1\nerror line 2\n```');
    });

    it('should ignore whitespace-only details when formatting completed tool', () => {
      const activity: AgentActivity = {
        kind: 'tool',
        toolCallId: 'call-2',
        title: 'git log',
        status: 'completed',
        details: '   \n  ',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBe('✅ **Completed**: `git log`');
    });

    it('should return null for unhandled tool status', () => {
      const activity = {
        kind: 'tool',
        toolCallId: 'call-4',
        title: 'unknown tool',
        status: 'pending' as any,
      } as AgentActivity;

      const result = formatter.formatActivity(activity);

      expect(result).toBeNull();
    });

    it('should return null for steering activity', () => {
      const activity: AgentActivity = {
        kind: 'steering',
        id: 'steer-1',
        text: 'Adjust course',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBeNull();
    });

    it('should return null for cancelled activity', () => {
      const activity: AgentActivity = {
        kind: 'cancelled',
        id: 'cancel-1',
      };

      const result = formatter.formatActivity(activity);

      expect(result).toBeNull();
    });
  });

  describe('stripLocalLinks', () => {
    it('should keep only the text of a file:// link with a line anchor', () => {
      const content = 'No componente [`src/Header.js`](file:///home/u/repo/src/Header.js#L51-L54):';

      expect(formatter.stripLocalLinks(content)).toBe('No componente `src/Header.js`:');
    });

    it('should keep only the text of links to absolute and relative paths', () => {
      const content = 'See [Header.js](/home/u/repo/Header.js) and [utils](src/utils.ts:12 "utils").';

      expect(formatter.stripLocalLinks(content)).toBe('See Header.js and utils.');
    });

    it('should keep only the alt text of a local image', () => {
      expect(formatter.stripLocalLinks('![diagram](file:///tmp/d.png)')).toBe('diagram');
    });

    it('should preserve web and mailto links', () => {
      const content = '[MR](https://gitlab.com/g/p/-/merge_requests/88) [docs](http://x.dev) [me](mailto:a@b.c)';

      expect(formatter.stripLocalLinks(content)).toBe(content);
    });

    it('should leave links inside fenced code blocks untouched', () => {
      const content = '[a](file:///a.ts)\n```md\n[b](file:///b.ts)\n```\n[c](file:///c.ts)';

      expect(formatter.stripLocalLinks(content)).toBe('a\n```md\n[b](file:///b.ts)\n```\nc');
    });

    it('should strip local links from thought activity', () => {
      const activity: AgentActivity = { kind: 'thought', id: '1', text: 'Reading [a.ts](file:///a.ts)' };

      expect(formatter.formatActivity(activity)).toBe('> 💭 *Reading a.ts*');
    });
  });

  describe('splitMessage', () => {
    it('should return empty array for empty string', () => {
      expect(formatter.splitMessage('')).toEqual([]);
    });

    it('should return single chunk if content is within maxLength', () => {
      const content = 'Hello Discord!';
      expect(formatter.splitMessage(content, 2000)).toEqual(['Hello Discord!']);
    });

    it('should split multi-line content without exceeding maxLength', () => {
      const lines = [
        'Line 1: Some content here',
        'Line 2: Another line of content',
        'Line 3: Final line here',
      ];
      const content = lines.join('\n');

      const chunks = formatter.splitMessage(content, 35);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(35);
      }
      expect(chunks.join('\n')).toBe(content);
    });

    it('should properly close and reopen code blocks across chunk splits', () => {
      const content = [
        '```typescript',
        'const a = 1;',
        'const b = 2;',
        'const c = 3;',
        '```',
      ].join('\n');

      const chunks = formatter.splitMessage(content, 35);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(35);
        expect(chunk.startsWith('```typescript')).toBe(true);
        expect(chunk.endsWith('```')).toBe(true);
      }
    });

    it('should split long single line exceeding maxLength', () => {
      const longLine = 'A'.repeat(50);
      const chunks = formatter.splitMessage(longLine, 20);

      expect(chunks).toEqual(['A'.repeat(20), 'A'.repeat(20), 'A'.repeat(10)]);
    });

    it('should split long single line inside code block and wrap each slice in code fences', () => {
      const longCodeLine = 'const x = ' + '9'.repeat(60) + ';';
      const content = `\`\`\`js\n${longCodeLine}\n\`\`\``;

      const chunks = formatter.splitMessage(content, 35);

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(35);
        expect(chunk.startsWith('```js')).toBe(true);
        expect(chunk.endsWith('```')).toBe(true);
      }
    });

    it('should properly close unclosed code block at end of content when split', () => {
      const content = '```python\n' + 'print("hello")\n'.repeat(5);
      const chunks = formatter.splitMessage(content, 40);

      expect(chunks.length).toBeGreaterThan(1);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk?.endsWith('```')).toBe(true);
    });

    it('should handle code blocks closing on regular boundary', () => {
      const content = 'Before code\n```python\nprint("hello")\n```\nAfter code';
      const chunks = formatter.splitMessage(content, 30);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(30);
      }
    });

    it('should split before a fence line when current chunk is full', () => {
      const content = 'Line 1 is quite long here\n```ts\nconst x = 1;\n```';
      const chunks = formatter.splitMessage(content, 26);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toBe('Line 1 is quite long here');
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(26);
      }
    });

    it('should keep lines after a sliced long line inside the code block', () => {
      const content = ['```ts', 'x'.repeat(50), 'const after = 1;', '```', 'outside'].join('\n');

      const chunks = formatter.splitMessage(content, 30);

      const afterChunk = chunks.find(chunk => chunk.includes('const after = 1;'))!;
      expect(afterChunk.startsWith('```ts\n')).toBe(true);
      expect(afterChunk.indexOf('const after = 1;')).toBeLessThan(afterChunk.lastIndexOf('```'));
      const outsideChunk = chunks.find(chunk => chunk.includes('outside'))!;
      expect(outsideChunk.match(/```/g)?.length ?? 0).toBe(0);
    });

    it('should reserve room for the closing fence when an opening fence fills the chunk', () => {
      const content = `${'a'.repeat(14)}\n\`\`\`ts\ncode\n\`\`\``;

      const chunks = formatter.splitMessage(content, 20);

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(20);
      }
    });

    describe('invariants', () => {
      const samples: [string, number][] = [
        [['intro', '```ts', 'x'.repeat(90), 'y', '```', 'z'.repeat(45)].join('\n'), 30],
        [['```', 'a'.repeat(10), '```', '```js', 'b'.repeat(70), '```'].join('\n'), 25],
        [Array.from({ length: 40 }, (_, i) => (i % 7 === 0 ? '```py' : `line ${i}`)).join('\n'), 40],
        [`${'q'.repeat(15)}\n\`\`\`\n${'w'.repeat(15)}\n\`\`\``, 20],
        ['```sh\n' + 'c'.repeat(300), 50],
      ];

      const withoutFences = (text: string): string =>
        text.split('\n').filter(line => !/^```/.test(line)).join('');

      it.each(samples)('should respect maxLength and balance fences (%#)', (content, maxLength) => {
        const chunks = formatter.splitMessage(content, maxLength);

        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(maxLength);
          expect((chunk.match(/^```/gm) ?? []).length % 2).toBe(0);
        }
        expect(withoutFences(chunks.join('\n'))).toBe(withoutFences(content));
      });
    });
  });

  describe('agent configuration', () => {
    const selection: AgentConfigSelection = {
      conversationId: 'ch-1',
      step: 'model',
      options: [
        { index: 1, id: 'fast', label: 'Fast Model', description: 'Quick answers' },
        { index: 2, id: 'deep', label: 'Deep Model' },
      ],
    };

    it('should format the footer with model and effort', () => {
      expect(
        formatter.formatAgentFooter({
          roleName: 'CEO',
          agentName: 'agy',
          modelName: 'Deep Model',
          effortName: 'High',
        }),
      ).toBe('-# 🤖 CEO (agy) · 🧠 Deep Model · ⚡ High');
    });

    const finishedDetails = {
      response: 'Done.',
      agentInfo: { roleName: 'Developer', agentName: 'agy', modelName: 'Deep Model', effortName: 'High' },
      durationMs: 42_100,
    };

    it('should announce a delegation with and without a project', () => {
      const delegation = { round: 1, role: 'DEVELOPER', roleName: 'Developer' };

      expect(formatter.formatDelegation({ ...delegation, phase: 'started', projectName: 'my-app' })).toBe(
        '🔀 **Task delegated** to agent **Developer** (`DEVELOPER`) in project `my-app` — it is working on it now.',
      );
      expect(formatter.formatDelegation({ ...delegation, phase: 'started' })).toBe(
        '🔀 **Task delegated** to agent **Developer** (`DEVELOPER`) — it is working on it now.',
      );
      expect(formatter.formatDelegation({ ...delegation, ...finishedDetails, phase: 'finished' })).toBe(
        '↩️ **Developer finished** — the CEO is reviewing the result.',
      );
      expect(formatter.formatDelegation({ ...delegation, ...finishedDetails, phase: 'finished', projectName: 'my-app' })).toBe(
        '↩️ **Developer finished** in project `my-app` — the CEO is reviewing the result.',
      );
    });

    it('should present the delegate response with its name and role', () => {
      expect(
        formatter.formatDelegateResult({
          round: 1,
          role: 'DEVELOPER',
          roleName: 'Developer',
          ...finishedDetails,
          phase: 'finished',
          response: '\nLogin implemented.\n',
        }),
      ).toBe('📋 **Response from agent Developer** (`DEVELOPER`):\nLogin implemented.');
    });

    it('should name the project in the delegate response when there is one', () => {
      expect(
        formatter.formatDelegateResult({
          round: 1,
          role: 'DEVELOPER',
          roleName: 'Developer',
          projectName: 'my-app',
          ...finishedDetails,
          phase: 'finished',
          response: 'Done.',
        }),
      ).toBe('📋 **Response from agent Developer** (`DEVELOPER`) in project `my-app`:\nDone.');
    });

    it('should show the delegate model, effort, tokens and duration in its footer', () => {
      expect(
        formatter.formatDelegateFooter({
          round: 1,
          role: 'DEVELOPER',
          roleName: 'Developer',
          ...finishedDetails,
          phase: 'finished',
          usage: { totalTokens: 12_345, inputTokens: 10_000, outputTokens: 2_345 },
        }),
      ).toBe('-# 🤖 Developer (agy) · 🧠 Deep Model · ⚡ High · 🪙 12.3k tokens · ⏱️ 42.1s');
    });


    it('should fall back to the default label in the footer', () => {
      expect(formatter.formatAgentFooter({ roleName: 'CEO', agentName: 'agy' })).toBe(
        '-# 🤖 CEO (agy) · 🧠 default · ⚡ default',
      );
    });

    it.each([
      [850, '850'],
      [12_345, '12.3k'],
      [2_500_000, '2.5M'],
    ])('should append the token usage %i to the footer', (totalTokens, label) => {
      expect(
        formatter.formatAgentFooter(
          { roleName: 'CEO', agentName: 'agy' },
          { totalTokens, inputTokens: 0, outputTokens: 0 },
        ),
      ).toBe(`-# 🤖 CEO (agy) · 🧠 default · ⚡ default · 🪙 ${label} tokens`);
    });

    it('should list the model options', () => {
      expect(formatter.formatSelection(selection)).toBe(
        [
          '🧠 **Choose the agent model** by replying with the option number:',
          '**1.** Fast Model — Quick answers',
          '**2.** Deep Model',
        ].join('\n'),
      );
    });

    it('should list the agent options', () => {
      expect(formatter.formatSelection({
        conversationId: 'ch-1',
        step: 'agent',
        options: [
          { index: 1, id: 'agy', label: 'Antigravity' },
          { index: 2, id: 'claude', label: 'Claude Code' },
        ],
      })).toBe(
        [
          '🤖 **Choose the agent** by replying with the option number:',
          '**1.** Antigravity',
          '**2.** Claude Code',
        ].join('\n'),
      );
    });

    it('should name the selected agent in the model step', () => {
      const text = formatter.formatSelection({
        ...selection,
        selectedAgent: { id: 'claude', name: 'Claude Code' },
      });

      expect(text.split('\n')[0]).toBe(
        '🧠 **Choose the Claude Code model** by replying with the option number:',
      );
    });

    it('should name the selected model in the effort step', () => {
      const text = formatter.formatSelection({
        ...selection,
        step: 'effort',
        selectedModel: { id: 'deep', name: 'Deep Model' },
      });

      expect(text.split('\n')[0]).toBe(
        '⚡ **Choose the effort for Deep Model** by replying with the option number:',
      );
    });

    it('should list the profiles with the exit instructions', () => {
      expect(formatter.formatSelection({
        conversationId: 'ch-1',
        step: 'profile',
        options: [
          { index: 1, id: 'CEO', label: 'CEO', description: 'Claude Code - Opus - default' },
          { index: 2, id: 'DEVELOPER', label: 'Developer' },
        ],
      })).toBe(
        [
          '👥 **Choose the profiles to configure** — type numbers separated by commas, or 0 to exit:',
          '**1.** CEO — Claude Code - Opus - default',
          '**2.** Developer',
        ].join('\n'),
      );
    });

    it('should mention that 0 goes back in the inner steps of the profiles flow', () => {
      const text = formatter.formatSelection({ ...selection, targetRoles: ['CEO'] });

      expect(text.split('\n').slice(0, 2)).toEqual([
        '🧠 **Choose the agent model** by replying with the option number:',
        'Type 0 to go back to the profile list.',
      ]);
    });

    it('should name the updated profiles and the applied settings', () => {
      const profile = {
        agentId: 'claude',
        agentName: 'Claude Code',
        modelId: 'deep',
        modelName: 'Deep Model',
        effortId: null,
        effortName: null,
      };

      expect(formatter.formatProfilesUpdated(
        [{ id: 'CEO', name: 'CEO' }, { id: 'DEVELOPER', name: 'Developer' }],
        profile,
      )).toBe('✅ **Profiles updated** (CEO, Developer): 🤖 Claude Code · 🧠 Deep Model · ⚡ default');
      expect(formatter.formatProfilesUpdated(
        [{ id: 'CEO', name: 'CEO' }],
        { ...profile, modelId: null, modelName: null, effortId: 'high', effortName: 'High' },
      )).toBe('✅ **Profiles updated** (CEO): 🤖 Claude Code · 🧠 default · ⚡ High');
    });

    it('should confirm that the profile configuration was closed', () => {
      expect(formatter.formatProfilesClosed()).toBe('✅ **Profile configuration closed.**');
    });

    it('should explain the valid range on an invalid answer', () => {
      expect(formatter.formatInvalidSelection(selection)).toMatch(
        /^⚠️ Invalid option\. Reply only with a number from 1 to 2\.\n\n🧠/,
      );
    });

    const withCeo = (settings: AgentSettings, overrides: Partial<AgentProfileSettings>): AgentSettings => ({
      ...settings,
      profiles: { CEO: { ...settings.profiles.CEO!, ...overrides } },
    });

    it('should confirm the saved settings', () => {
      const settings = {
        profiles: {
          CEO: {
            agentId: 'claude',
            agentName: 'Claude Code',
            modelId: 'deep',
            modelName: 'Deep Model',
            effortId: null,
            effortName: null,
          },
        },
        updatedAt: '',
      };

      expect(formatter.formatConfigured(settings)).toBe(
        '✅ **Settings saved for all profiles**: 🤖 Claude Code · 🧠 Deep Model · ⚡ default',
      );
      expect(formatter.formatConfigured(withCeo(settings, { effortId: 'high', effortName: 'High' }))).toBe(
        '✅ **Settings saved for all profiles**: 🤖 Claude Code · 🧠 Deep Model · ⚡ High',
      );
      expect(formatter.formatConfigured(withCeo(settings, { modelId: null, modelName: null }))).toBe(
        '✅ **Settings saved for all profiles**: 🤖 Claude Code · 🧠 default · ⚡ default',
      );
    });
  });

  describe('settings confirmation fallbacks', () => {
    const claude: AgentProfileSettings = {
      agentId: 'claude',
      agentName: 'Claude Code',
      modelId: null,
      modelName: null,
      effortId: null,
      effortName: null,
    };

    it('should describe the first profile when the settings have no CEO profile', () => {
      expect(formatter.formatConfigured({ profiles: { DEVELOPER: claude }, updatedAt: '' })).toBe(
        '✅ **Settings saved for all profiles**: 🤖 Claude Code · 🧠 default · ⚡ default',
      );
    });

    it('should omit the details when the settings have no profile', () => {
      expect(formatter.formatConfigured({ profiles: {}, updatedAt: '' })).toBe(
        '✅ **Settings saved for all profiles**',
      );
    });
  });

  describe('questions to the user', () => {
    const prompt: QuestionPrompt = {
      asker: { role: 'PRODUCT_OWNER', roleName: 'Product Owner Agent', projectName: 'my-app' },
      question: { text: 'Who approves?', rationale: 'It defines the flow.', options: ['Manager', 'Finance'] },
      number: 2,
      total: 5,
      waitingAskers: 0,
    };

    it('should show the question with its rationale and numbered options', () => {
      expect(formatter.formatQuestion(prompt)).toBe([
        '❓ **Question 2/5** · Product Owner Agent (`my-app`)',
        '**Who approves?**',
        '_It defines the flow._',
        '**1.** Manager',
        '**2.** Finance',
        '-# Reply with the option number or type another answer. /cancel stops everything.',
      ].join('\n'));
    });

    it('should lead with the agent message and tell how many agents wait for answers', () => {
      const formatted = formatter.formatQuestion({ ...prompt, message: 'I understood X.', waitingAskers: 2 });

      expect(formatted).toMatch(/^I understood X\.\n\n❓/);
      expect(formatted).toMatch(/-# ⏳ 2 more agent\(s\) waiting for answers after this one\.$/);
    });

    it('should ask for a typed answer when the question has no options', () => {
      const formatted = formatter.formatQuestion({
        ...prompt,
        asker: { ...prompt.asker, projectName: null },
        question: { text: 'What is the limit?', options: [] },
      });

      expect(formatted).toBe([
        '❓ **Question 2/5** · Product Owner Agent',
        '**What is the limit?**',
        '-# Type your answer. /cancel stops everything.',
      ].join('\n'));
    });

    it('should repeat the question without the agent message on an invalid option', () => {
      const formatted = formatter.formatInvalidAnswer({ ...prompt, message: 'I understood X.' });

      expect(formatted).toMatch(/^⚠️ Invalid option\. Reply with a number from 1 to 2 or type another answer\.\n\n❓/);
      expect(formatted).not.toContain('I understood X.');
    });

    it('should confirm the answers were sent to the asking agent', () => {
      expect(formatter.formatAnswersSent(prompt.asker)).toBe('✅ Answers sent to **Product Owner Agent** (`my-app`).');
      expect(formatter.formatAnswersSent({ ...prompt.asker, projectName: null })).toBe('✅ Answers sent to **Product Owner Agent**.');
    });
  });

  describe('formatTranscripts', () => {
    it('should quote each transcript under its file name', () => {
      expect(formatter.formatTranscripts([
        { name: 'a.ogg', text: 'line one\nline two' },
        { name: 'b.ogg', text: 'second' },
      ])).toBe('🎙️ **a.ogg**\n> line one\n> line two\n\n🎙️ **b.ogg**\n> second');
    });
  });

  describe('formatQuota', () => {
    const agent = { id: 'agy', name: 'Antigravity' };

    it('should explain when no agent CLI was found', () => {
      expect(formatter.formatQuota([])).toBe('ℹ️ No agent CLI was found in the PATH.');
    });

    it('should explain when the agent has no quota information', () => {
      expect(formatter.formatQuota([{ agent, status: 'unsupported' }])).toBe(
        '📊 **Antigravity usage**\nℹ️ This agent does not expose usage information.',
      );
    });

    it('should explain when the agent could not be queried', () => {
      expect(formatter.formatQuota([{ agent, status: 'failed' }])).toBe(
        '📊 **Antigravity usage**\nℹ️ Usage could not be queried.',
      );
    });

    it('should give each agent its own section', () => {
      const text = formatter.formatQuota([
        {
          agent,
          status: 'ok',
          quota: { groups: [{ name: 'Gemini', buckets: [{ id: 'b', name: 'Weekly', window: 'weekly', remainingFraction: 0.5 }] }] },
        },
        { agent: { id: 'copilot', name: 'GitHub Copilot' }, status: 'failed' },
        { agent: { id: 'codex', name: 'OpenAI Codex' }, status: 'unsupported' },
      ]);

      expect(text).toBe(
        [
          '📊 **Antigravity usage**',
          '🟢 ▰▰▰▰▰▱▱▱▱▱ 50% Week',
          '',
          '📊 **GitHub Copilot usage**',
          'ℹ️ Usage could not be queried.',
          '',
          '📊 **OpenAI Codex usage**',
          'ℹ️ This agent does not expose usage information.',
        ].join('\n'),
      );
    });

    it('should draw a bar, a marker and a label per bucket with the relative reset time', () => {
      const text = formatter.formatQuota([
        {
          agent,
          status: 'ok',
          quota: {
            groups: [
              {
                name: 'Gemini Models',
                buckets: [
                  {
                    id: 'g-5h',
                    name: 'Five Hour Limit Remaining',
                    window: '5h',
                    remainingFraction: 0.9364,
                    resetTime: '2026-10-11T23:03:22Z',
                  },
                  { id: 'g-m', name: 'Monthly', window: 'monthly', remainingFraction: 0.4 },
                  { id: 'g-7', name: 'Seven', window: '7d', remainingFraction: 0.2 },
                  {
                    id: 'g-x',
                    name: 'Broken',
                    window: 'custom',
                    remainingFraction: 0,
                    resetTime: 'not-a-date',
                  },
                  { id: 'g-o', name: 'Over', window: '5h', remainingFraction: 1.5 },
                  { id: 'g-n', name: 'Under', window: '5h', remainingFraction: -1 },
                ],
              },
            ],
          },
        },
      ]);

      expect(text).toBe(
        [
          '📊 **Antigravity usage**',
          '🟢 ▰▰▰▰▰▰▰▰▰▱ 94% 5h · resets <t:1791759802:R>',
          '🟡 ▰▰▰▰▱▱▱▱▱▱ 40% Month',
          '🟡 ▰▰▱▱▱▱▱▱▱▱ 20% Week',
          '🔴 ▱▱▱▱▱▱▱▱▱▱ 0% Broken',
          '🟢 ▰▰▰▰▰▰▰▰▰▰ 100% 5h',
          '🔴 ▱▱▱▱▱▱▱▱▱▱ 0% 5h',
        ].join('\n'),
      );
    });

    it('should title each group when the agent has more than one', () => {
      const text = formatter.formatQuota([
        {
          agent,
          status: 'ok',
          quota: {
            groups: [
              { name: 'Gemini', buckets: [{ id: 'a', name: 'A', window: 'weekly', remainingFraction: 1 }] },
              { name: 'Claude', buckets: [{ id: 'b', name: 'B', window: '5h', remainingFraction: 0.1 }] },
            ],
          },
        },
      ]);

      expect(text).toBe(
        [
          '📊 **Antigravity usage**',
          '',
          '**Gemini**',
          '🟢 ▰▰▰▰▰▰▰▰▰▰ 100% Week',
          '',
          '**Claude**',
          '🔴 ▰▱▱▱▱▱▱▱▱▱ 10% 5h',
        ].join('\n'),
      );
    });
  });

  describe('formatShellResult', () => {
    const baseResult = {
      command: 'echo hi',
      exitCode: 0,
      output: 'hi\n',
      truncated: false,
      timedOut: false,
      cancelled: false,
    };

    it('should render the command, the output and a successful exit code', () => {
      expect(new DiscordActivityFormatter().formatShellResult(baseResult))
        .toBe('```\n$ echo hi\nhi\n```\n✅ **Exit code 0**');
    });

    it('should omit the output block content when there is no output and flag a failing exit code', () => {
      expect(new DiscordActivityFormatter().formatShellResult({ ...baseResult, output: '', exitCode: 3 }))
        .toBe('```\n$ echo hi\n```\n❌ **Exit code 3**');
    });

    it('should escape code fences coming from the command or the output', () => {
      const text = new DiscordActivityFormatter().formatShellResult({
        ...baseResult,
        command: 'echo ```',
        output: '```',
      });

      expect(text.match(/```/g)).toHaveLength(2);
    });

    it('should flag truncation, timeout and cancellation', () => {
      const formatter = new DiscordActivityFormatter();

      expect(formatter.formatShellResult({ ...baseResult, truncated: true }))
        .toContain('✅ **Exit code 0** · output truncated to the last characters');
      expect(formatter.formatShellResult({ ...baseResult, timedOut: true, truncated: true }))
        .toContain('⏱️ **Timed out** · output truncated');
      expect(formatter.formatShellResult({ ...baseResult, cancelled: true }))
        .toContain('🛑 **Cancelled**');
    });
  });
});
