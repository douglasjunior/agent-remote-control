import type { AgentOption } from '@agent-remote-control/protocol/agent-option';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../ui/button.js';

import { completeChoice, type ProfileChoice, type ProfileDraft } from './profile-choice.js';
import { RoleEditor } from './role-editor.js';
import type { AgentOptions } from './use-agent-options.js';


/** The settings sheet's editor of one role, or of every role: a `RoleEditor` saved or cancelled as a whole. */
export function RoleForm({ label, agents, initial, options, saving, error, saveLabel, onSave, onCancel }: {
  readonly label: string;
  readonly agents: readonly AgentOption[];
  readonly initial: ProfileDraft;
  readonly options: AgentOptions;
  readonly saving: boolean;
  readonly error: string | null;
  readonly saveLabel: string;
  readonly onSave: (choice: ProfileChoice) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const form = useRef<HTMLDivElement>(null);
  const choice = completeChoice(draft, agents, options);

  useEffect(() => {
    form.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, []);

  return (
    <div ref={form} role="group" aria-label={label} className="flex flex-col gap-3 pt-3">
      <RoleEditor agents={agents} value={draft} options={options} onChange={setDraft} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" disabled={!choice || saving} aria-busy={saving} onClick={() => onSave(choice!)}>
          {saving && <LoaderCircle className="animate-spin" />}
          {saving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </div>
  );
}
