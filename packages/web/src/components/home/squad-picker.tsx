import type { Squad } from '@agent-remote-control/protocol/squad';
import { Users } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';

import { CUSTOM_SQUAD } from './squad-choice.js';


/** Which squad sets the roles of the conversation about to start. */
export function SquadPicker({ squads, value, onChange }: {
  readonly squads: readonly Squad[];
  readonly value: string;
  readonly onChange: (squadId: string) => void;
}) {
  const items = [
    ...squads.map(squad => ({ value: squad.id, label: squad.isDefault ? `${squad.name} (default)` : squad.name })),
    { value: CUSTOM_SQUAD, label: 'Custom (inherit)' },
  ];

  return (
    <Select value={value} onValueChange={next => typeof next === 'string' && onChange(next)} items={items}>
      <SelectTrigger aria-label="Squad" size="sm" className="max-w-full min-w-0 border-transparent text-muted-foreground hover:text-foreground dark:bg-transparent">
        <Users aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
