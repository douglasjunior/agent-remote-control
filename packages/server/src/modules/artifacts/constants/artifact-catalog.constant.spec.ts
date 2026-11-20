import {
  ARTIFACT_SECTIONS as PROTOCOL_SECTIONS,
  ARTIFACT_STATUSES as PROTOCOL_STATUSES,
  REFINEMENT_KINDS as PROTOCOL_REFINEMENT_KINDS,
  WORK_ENDING_STATUSES as PROTOCOL_WORK_ENDING_STATUSES,
} from '@agent-remote-control/protocol/artifact';
import { describe, expect, it } from '@rstest/core';

import { ARTIFACT_SECTIONS, ARTIFACT_STATUSES, REFINEMENT_KINDS, WORK_ENDING_STATUSES } from './artifact-catalog.constant.js';


describe('artifact-catalog.constant', () => {
  it('should keep the statuses the channels know through the protocol', () => {
    expect(ARTIFACT_STATUSES).toEqual(PROTOCOL_STATUSES);
    expect(WORK_ENDING_STATUSES).toEqual(PROTOCOL_WORK_ENDING_STATUSES);
  });

  it('should keep the sections and refinement kinds the channels know through the protocol', () => {
    expect(ARTIFACT_SECTIONS).toEqual(PROTOCOL_SECTIONS);
    expect(REFINEMENT_KINDS).toEqual(PROTOCOL_REFINEMENT_KINDS);
  });
});
