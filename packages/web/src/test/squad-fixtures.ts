import type { Squad } from '@agent-remote-control/protocol/squad';

import { AT } from './render-app.js';


export function squad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: 's1',
    name: 'Backend team',
    isDefault: false,
    profiles: [{ role: 'CEO', roleName: 'CEO', agent: { id: 'codex', name: 'Codex', available: true } }],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}
