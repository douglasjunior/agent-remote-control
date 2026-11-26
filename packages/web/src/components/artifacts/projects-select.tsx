import {
  Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor,
} from '../ui/combobox.js';


/**
 * A shadcn combobox that picks several of `choices`, each pick shown as a chip. With `minSelected` the last picks
 * cannot be removed; `label` names the input for assistive technology.
 */
export function ProjectsSelect({ label, value, choices, onChange, minSelected = 0 }: {
  readonly label: string;
  readonly value: readonly string[];
  readonly choices: readonly string[];
  readonly onChange: (projects: string[]) => void;
  readonly minSelected?: number;
}) {
  const anchor = useComboboxAnchor();
  return (
    <Combobox multiple items={choices} value={[...value]} onValueChange={next => next.length >= minSelected && onChange(next)}>
      <ComboboxChips ref={anchor} className="w-full">
        <ComboboxValue>
          {(selected: string[]) => (
            <>
              {selected.map(project => <ComboboxChip key={project} showRemove={selected.length > minSelected} removeLabel={`Remove ${project}`}>{project}</ComboboxChip>)}
              <ComboboxChipsInput aria-label={label} placeholder={selected.length === 0 ? 'Choose projects' : undefined} />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No project found.</ComboboxEmpty>
        <ComboboxList>
          {(project: string) => <ComboboxItem key={project} value={project}>{project}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
