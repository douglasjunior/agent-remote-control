import { beforeEach, describe, expect, it, rs } from '@rstest/core';

import type { ConfigureProfilesResult } from '../models/configure-profiles.model.js';
import { buildStubProfile } from '../testing/stub-agent-settings-store.js';
import type { ConfigureAgentProfilesUseCase } from '../use-cases/configure-agent-profiles.use-case.js';

import type { AgentCapabilitiesService } from './agent-capabilities.service.js';
import { AgentConfigurationService } from './agent-configuration.service.js';
import type { AgentProfilesService } from './agent-profiles.service.js';
import type { UserLanguageService } from './user-language.service.js';


const AGENT = { id: 'stub', name: 'Stub Agent' };

describe('AgentConfigurationService', () => {
  let service: AgentConfigurationService;
  let capabilities: AgentCapabilitiesService;
  let profiles: AgentProfilesService;
  let language: UserLanguageService;
  let configure: ConfigureAgentProfilesUseCase;

  beforeEach(() => {
    capabilities = {
      listAgentOptions: rs.fn().mockReturnValue([AGENT]),
      listModelOptions: rs.fn().mockResolvedValue([{ id: 'fast', name: 'Fast' }]),
      listEffortOptions: rs.fn().mockResolvedValue([{ id: 'high', name: 'High' }]),
      resolveAgent: rs.fn().mockReturnValue(AGENT),
    } as unknown as AgentCapabilitiesService;
    profiles = {
      current: rs.fn().mockResolvedValue(null),
      list: rs.fn().mockResolvedValue([]),
      listRoles: rs.fn().mockReturnValue([{ role: 'CEO', roleName: 'CEO' }]),
      save: rs.fn().mockResolvedValue({ profiles: {}, updatedAt: '' }),
      ensure: rs.fn().mockResolvedValue('configured'),
    } as unknown as AgentProfilesService;
    language = {
      get: rs.fn().mockResolvedValue('Spanish'),
      set: rs.fn().mockResolvedValue('French'),
    } as unknown as UserLanguageService;
    configure = { execute: rs.fn().mockResolvedValue({ ok: true }) } as unknown as ConfigureAgentProfilesUseCase;
    service = new AgentConfigurationService(capabilities, profiles, language, configure);
  });

  it('should list agents, models and efforts through the capabilities', async () => {
    expect(service.listAgents()).toEqual([AGENT]);
    await expect(service.listModels('stub')).resolves.toEqual([{ id: 'fast', name: 'Fast' }]);
    await expect(service.listEfforts('stub', 'fast')).resolves.toEqual([{ id: 'high', name: 'High' }]);
    expect(capabilities.listModelOptions).toHaveBeenCalledWith('stub');
    expect(capabilities.listEffortOptions).toHaveBeenCalledWith('stub', 'fast');
  });

  it('should resolve the default agent, and the current agent from the conversation settings', async () => {
    const settings = { profiles: { CEO: buildStubProfile('stub') }, updatedAt: '' };
    rs.mocked(profiles.current).mockResolvedValue(settings);

    expect(service.getDefaultAgent()).toEqual(AGENT);
    expect(capabilities.resolveAgent).toHaveBeenCalledWith(null);
    await expect(service.currentAgent('conv-1')).resolves.toEqual(AGENT);
    expect(capabilities.resolveAgent).toHaveBeenLastCalledWith(settings);
  });

  it('should list roles and profiles and ensure the settings of a conversation', async () => {
    expect(service.listRoles()).toEqual([{ role: 'CEO', roleName: 'CEO' }]);
    await service.listProfiles('conv-1');

    expect(profiles.list).toHaveBeenCalledWith('conv-1');
    await expect(service.ensureSettings('conv-1')).resolves.toBe('configured');
  });

  it('should report whether the conversation has settings to run with, without changing anything', async () => {
    await expect(service.hasSettings('conv-1')).resolves.toBe(false);

    rs.mocked(profiles.current).mockResolvedValue({ profiles: {}, updatedAt: '' });

    await expect(service.hasSettings('conv-1')).resolves.toBe(true);
    expect(profiles.ensure).not.toHaveBeenCalled();
  });

  it('should save a resolved profile and configure by ids', async () => {
    const profile = buildStubProfile('stub');
    const result: ConfigureProfilesResult = { ok: true };

    await service.saveProfiles('conv-1', ['CEO'], profile);
    await expect(service.configureProfiles({ conversationId: 'conv-1', agentId: 'stub' })).resolves.toEqual(result);

    expect(profiles.save).toHaveBeenCalledWith('conv-1', ['CEO'], profile);
    expect(configure.execute).toHaveBeenCalledWith({ conversationId: 'conv-1', agentId: 'stub' });
  });

  it('should read and set the user language', async () => {
    await expect(service.getLanguage()).resolves.toBe('Spanish');
    await expect(service.setLanguage('French')).resolves.toBe('French');
    expect(language.set).toHaveBeenCalledWith('French');
  });
});
