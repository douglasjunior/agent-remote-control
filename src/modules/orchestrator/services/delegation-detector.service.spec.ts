import { describe, expect, it } from 'vitest';

import { DelegationDetectorService } from './delegation-detector.service.js';


describe('DelegationDetectorService', () => {
  const service = new DelegationDetectorService();

  it('should detect delegate with role and project', () => {
    const result = service.detect('Please do this.\n[DELEGATE:DEVELOPER:my-app]');
    expect(result).toEqual({
      kind: 'delegate',
      delegation: {
        delegateToRole: 'DEVELOPER',
        projectName: 'my-app',
        taskSpec: 'Please do this.',
      },
    });
  });

  it('should detect delegate with role only', () => {
    const result = service.detect('Just do this.\n[DELEGATE:DEVELOPER]');
    expect(result).toEqual({
      kind: 'delegate',
      delegation: {
        delegateToRole: 'DEVELOPER',
        projectName: undefined,
        taskSpec: 'Just do this.',
      },
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
      delegation: {
        delegateToRole: 'DEVELOPER',
        projectName: 'my-app',
        taskSpec: 'Sure, delegating.\n\n> Clone the repo.',
      },
    });
  });

  it('should accept markers wrapped in markdown formatting and normalize the role', () => {
    expect(service.detect('Task.\n**`[delegate:developer:my-app]`**')).toEqual({
      kind: 'delegate',
      delegation: { delegateToRole: 'DEVELOPER', projectName: 'my-app', taskSpec: 'Task.' },
    });
    expect(service.detect('Finished.\n_[DONE]_')).toEqual({ kind: 'done', summary: 'Finished.' });
  });

  it('should reject markers that share a line with other text', () => {
    expect(service.detect('Start [DONE] middle.')).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('alone on its own line'),
    });
  });

  it('should reject responses with more than one marker', () => {
    expect(service.detect('[DELEGATE:DEVELOPER]\nWork.\n[DONE]')).toEqual({
      kind: 'invalid',
      reason: expect.stringContaining('more than one marker'),
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
