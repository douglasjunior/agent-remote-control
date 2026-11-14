import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import { LoaderCircle } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';

import type { OptionList } from './use-agent-options.js';


/** One labeled choice of the editor: the trigger says what is loading, and an empty list says why there is nothing to pick. */
export function OptionSelect({ label, value, options, placeholder, emptyText, onChange }: {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: OptionList | undefined;
  readonly placeholder: string;
  readonly emptyText: string;
  readonly onChange: (id: string) => void;
}) {
  const loading = options === 'loading';
  const items = Array.isArray(options) ? options as readonly AgentOption[] : [];
  const selected = items.some(option => option.id === value) ? value : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {Array.isArray(options) && items.length === 0
        ? <p className="flex h-8 items-center text-xs text-muted-foreground">{emptyText}</p>
        : (
          <Select
            value={selected}
            onValueChange={next => typeof next === 'string' && onChange(next)}
            items={items.map(option => ({ value: option.id, label: option.name }))}
            disabled={options === undefined || loading}
          >
            <SelectTrigger aria-label={label} aria-busy={loading} className="w-full min-w-0">
              {loading
                ? (
                  <span role="status" className="flex items-center gap-1.5 text-muted-foreground">
                    <LoaderCircle className="animate-spin" />
                    Loading…
                  </span>
                )
                : <SelectValue placeholder={placeholder} />}
            </SelectTrigger>
            <SelectContent>
              {items.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
    </div>
  );
}
