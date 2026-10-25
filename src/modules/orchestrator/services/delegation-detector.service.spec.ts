import { describe, expect, it } from 'vitest';

import { DelegationDetectorService } from './delegation-detector.service.js';


describe('DelegationDetectorService', () => {
  const service = new DelegationDetectorService();

  it('should detect delegate with role and project', () => {
    const result = service.detect('Please do this.\n[DELEGATE:DEVELOPER:my-app]');
    expect(result).toEqual({
      kind: 'delegate',
      delegations: [
        {
          delegateToRole: 'DEVELOPER',
          projectName: 'my-app',
          taskSpec: 'Please do this.',
        },
      ],
    });
  });

  it('should detect delegate with role only', () => {
    const result = service.detect('Just do this.\n[DELEGATE:DEVELOPER]');
    expect(result).toEqual({
      kind: 'delegate',
      delegations: [
        {
          delegateToRole: 'DEVELOPER',
          projectName: undefined,
          taskSpec: 'Just do this.',
        },
      ],
    });
  });

  it('should detect delegate with role, project, and session mode new', () => {
    const result = service.detect('Review diff.\n[DELEGATE:CODE_REVIEWER:my-app:new]');
    expect(result).toEqual({
      kind: 'delegate',
      delegations: [
        {
          delegateToRole: 'CODE_REVIEWER',
          projectName: 'my-app',
          taskSpec: 'Review diff.',
          sessionMode: 'new',
        },
      ],
    });
  });

  it('should detect delegate with role, project, and session mode resume', () => {
    const result = service.detect('Continue task.\n[DELEGATE:DEVELOPER:my-app:resume]');
    expect(result).toEqual({
      kind: 'delegate',
      delegations: [
        {
          delegateToRole: 'DEVELOPER',
          projectName: 'my-app',
          taskSpec: 'Continue task.',
          sessionMode: 'resume',
        },
      ],
    });
  });

  it('should detect delegate with role and session mode without project folder', () => {
    const resultColon = service.detect('Clean review.\n[DELEGATE:CODE_REVIEWER::new]');
    expect(resultColon).toEqual({
      kind: 'delegate',
      delegations: [
        {
          delegateToRole: 'CODE_REVIEWER',
          projectName: undefined,
          taskSpec: 'Clean review.',
          sessionMode: 'new',
        },
      ],
    });

    const resultDirect = service.detect('Clean review.\n[DELEGATE:CODE_REVIEWER:new]');
    expect(resultDirect).toEqual({
      kind: 'delegate',
      delegations: [
        {
          delegateToRole: 'CODE_REVIEWER',
          projectName: undefined,
          taskSpec: 'Clean review.',
          sessionMode: 'new',
        },
      ],
    });
  });

  it('should reject delegation marker with invalid session mode', () => {
    const result = service.detect('Task.\n[DELEGATE:DEVELOPER:my-app:invalid]');
    expect(result).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('Session mode must be "new" or "resume"'),
    });
  });

  it('should detect done marker', () => {
    const result = service.detect('All finished.\n[DONE]');
    expect(result).toEqual({
      kind: 'done',
      summary: 'All finished.',
    });
  });

  it('should return direct_response when no marker is present', () => {
    const result = service.detect('Hello world!');
    expect(result).toEqual({ kind: 'direct_response' });
  });

  it('should detect a delegate marker followed by the task specification', () => {
    const result = service.detect('Sure, delegating.\n\n[DELEGATE:DEVELOPER:my-app]\n\n> Clone the repo.');
    expect(result).toEqual({
      kind: 'delegate',
      delegations: [
        {
          delegateToRole: 'DEVELOPER',
          projectName: 'my-app',
          taskSpec: 'Sure, delegating.\n\n> Clone the repo.',
        },
      ],
    });
  });

  it('should accept markers wrapped in markdown formatting and normalize the role', () => {
    expect(service.detect('Task.\n**`[delegate:developer:my-app]`**')).toEqual({
      kind: 'delegate',
      delegations: [{ delegateToRole: 'DEVELOPER', projectName: 'my-app', taskSpec: 'Task.' }],
    });
    expect(service.detect('Finished.\n_[DONE]_')).toEqual({ kind: 'done', summary: 'Finished.' });
  });

  it('should reject markers that share a line with other text', () => {
    expect(service.detect('Start [DONE] middle.')).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('alone on its own line'),
    });
  });

  it('should reject [DONE] combined with other markers', () => {
    expect(service.detect('Work.\n[DELEGATE:DEVELOPER]\nDone.\n[DONE]')).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('[DONE] cannot be combined with other markers'),
    });
  });

  describe('parallel delegations', () => {
    it('should split several delegations, each taking the text right before its marker', () => {
      const result = service.detect([
        'Build the API.',
        '[DELEGATE:DEVELOPER:backend]',
        'Build the screen.',
        '[DELEGATE:DEVELOPER:frontend:new]',
        'Plan the migration.',
        '[DELEGATE:TECH_LEAD]',
      ].join('\n'));

      expect(result).toEqual({
        kind: 'delegate',
        delegations: [
          { delegateToRole: 'DEVELOPER', projectName: 'backend', taskSpec: 'Build the API.' },
          { delegateToRole: 'DEVELOPER', projectName: 'frontend', taskSpec: 'Build the screen.', sessionMode: 'new' },
          { delegateToRole: 'TECH_LEAD', projectName: undefined, taskSpec: 'Plan the migration.' },
        ],
      });
    });

    it('should reject text after the last marker', () => {
      expect(service.detect('A.\n[DELEGATE:DEVELOPER:a]\nB.\n[DELEGATE:DEVELOPER:b]\nTrailing.')).toEqual({
        kind: 'invalid',
        reason: expect.stringContaining('nothing follows the last marker'),
      });
    });

    it('should reject a delegation without its own specification', () => {
      expect(service.detect('A.\n[DELEGATE:DEVELOPER:a]\n[DELEGATE:DEVELOPER:b]')).toEqual({
        kind: 'invalid',
        reason: expect.stringContaining('Delegation 2 ("[DELEGATE:DEVELOPER:b]") has no task specification'),
      });
    });

    it('should reject a malformed marker among several', () => {
      expect(service.detect('A.\n[DELEGATE:DEVELOPER:a]\nB.\n[DELEGATE:DEVELOPER:b:later]')).toEqual({
        kind: 'invalid',
        reason: expect.stringContaining('Session mode must be "new" or "resume"'),
      });
    });
  });

  it('should reject a done marker with arguments', () => {
    expect(service.detect('Ok.\n[DONE:now]')).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('Malformed done marker "[DONE:now]"'),
    });
  });

  it('should reject a malformed delegation marker', () => {
    expect(service.detect('Task.\n[DELEGATE DEVELOPER]')).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('Malformed delegation marker "[DELEGATE DEVELOPER]"'),
    });
    expect(service.detect('Task.\n[DELEGATE:DEVELOPER:my app]')).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('Malformed delegation marker'),
    });
  });

  it('should reject a delegation without task specification', () => {
    expect(service.detect('[DELEGATE:DEVELOPER:my-app]')).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('no task specification'),
    });
  });
});
