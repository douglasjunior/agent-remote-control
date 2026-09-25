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

  it('should ignore markers that are not at the end of the response', () => {
    const result = service.detect('Start [DONE] middle.');
    expect(result).toEqual({ kind: 'direct_response' });
  });
});
