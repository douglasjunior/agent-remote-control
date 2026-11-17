import { ARTIFACT_STATUSES as PROTOCOL_STATUSES, WORK_ENDING_STATUSES as PROTOCOL_WORK_ENDING_STATUSES } from '@agent-remote-control/protocol/artifact';
import { describe, expect, it } from '@rstest/core';

import { ARTIFACT_STATUSES, WORK_ENDING_STATUSES } from './artifact-catalog.constant.js';


describe('artifact-catalog.constant', () => {
  it('should keep the statuses the channels know through the protocol', () => {
    expect(ARTIFACT_STATUSES).toEqual(PROTOCOL_STATUSES);
    expect(WORK_ENDING_STATUSES).toEqual(PROTOCOL_WORK_ENDING_STATUSES);
  });
});
