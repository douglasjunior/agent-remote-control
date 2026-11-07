import type { AgentOption } from '../../orchestrator/models/agent-option.model.js';
import type { SelectionOption } from '../models/agent-config-selection.model.js';


/** Numbers the options from 1, the way the menus show and read them. */
export function toSelectionOptions(options: readonly AgentOption[]): SelectionOption[] {
  return options.map((option, position) => ({
    index: position + 1,
    id: option.id,
    label: option.name,
    description: option.description,
  }));
}
