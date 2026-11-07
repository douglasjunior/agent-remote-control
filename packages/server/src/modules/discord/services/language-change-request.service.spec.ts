import { describe, expect, it } from 'vitest';

import { LanguageChangeRequestService } from './language-change-request.service.js';


describe('LanguageChangeRequestService', () => {
  it('should keep a request per conversation until cancelled', () => {
    const service = new LanguageChangeRequestService();

    service.request('conv-1');

    expect(service.isPending('conv-1')).toBe(true);
    expect(service.isPending('conv-2')).toBe(false);
    expect(service.cancel('conv-1')).toBe(true);
    expect(service.cancel('conv-1')).toBe(false);
    expect(service.isPending('conv-1')).toBe(false);
  });
});
