import { describe, expect, it } from 'vitest';

import type { AgentProfileSettings, AgentSettings } from '../models/agent-settings.model.js';

import { profileForAllRoles, resolveProfile, withProfiles } from './agent-profile.util.js';


const profile = (agentId: string): AgentProfileSettings => ({
  agentId,
  agentName: agentId,
  modelId: null,
  modelName: null,
  effortId: null,
  effortName: null,
});

describe('agent-profile.util', () => {
  const settings: AgentSettings = {
    profiles: { CEO: profile('claude'), DEVELOPER: profile('agy') },
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  describe('resolveProfile', () => {
    it('should return the profile of the role', () => {
      expect(resolveProfile(settings, 'DEVELOPER')).toEqual(profile('agy'));
    });

    it('should fall back to the CEO profile when the role has none', () => {
      expect(resolveProfile(settings, 'GIT_OPS')).toEqual(profile('claude'));
    });

    it('should return undefined when neither the role nor the CEO has a profile', () => {
      expect(resolveProfile({ profiles: {}, updatedAt: '' }, 'DEVELOPER')).toBeUndefined();
    });
  });

  describe('profileForAllRoles', () => {
    it('should map every role to the profile', () => {
      expect(profileForAllRoles(['CEO', 'GIT_OPS'], profile('copilot'))).toEqual({
        CEO: profile('copilot'),
        GIT_OPS: profile('copilot'),
      });
    });
  });

  describe('withProfiles', () => {
    it('should apply the profile only to the given roles and refresh updatedAt', () => {
      const updated = withProfiles(settings, ['CEO', 'GIT_OPS'], profile('copilot'));

      expect(updated.profiles).toEqual({
        CEO: profile('copilot'),
        GIT_OPS: profile('copilot'),
        DEVELOPER: profile('agy'),
      });
      expect(updated.updatedAt).not.toBe(settings.updatedAt);
      expect(settings.profiles.CEO).toEqual(profile('claude'));
    });
  });
});
