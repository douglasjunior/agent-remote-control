import { cn } from '../../lib/utils.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';


export type Choice = { readonly value: string; readonly label: string };

/** A shadcn select over plain string choices; `label` names it for assistive technology. */
export function ChoiceSelect({ label, value, choices, onChange, size = 'default', className, disabled }: {
  readonly label: string;
  readonly value: string;
  readonly choices: readonly Choice[];
  readonly onChange: (value: string) => void;
  readonly size?: 'sm' | 'default';
  readonly className?: string;
  readonly disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={next => next !== null && onChange(next)} items={choices} disabled={disabled}>
      <SelectTrigger aria-label={label} size={size} className={cn('min-w-0', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map(choice => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
