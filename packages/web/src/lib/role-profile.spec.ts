import { profileSummary } from './role-profile.js';


describe('profileSummary', () => {
  it('joins the agent, model and effort the role runs on', () => {
    expect(profileSummary({
      role: 'QA',
      roleName: 'QA Agent',
      agent: { id: 'copilot', name: 'GitHub Copilot', available: true },
      model: { id: 'auto', name: 'Auto' },
      effort: { id: 'high', name: 'High' },
    })).toBe('GitHub Copilot · Auto · High');
    expect(profileSummary({ role: 'QA', roleName: 'QA Agent', agent: { id: 'codex', name: 'Codex', available: false } })).toBe('Codex');
    expect(profileSummary({ role: 'QA', roleName: 'QA Agent' })).toBe('Not configured');
  });
});
