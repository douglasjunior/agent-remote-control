import type { ArtifactSection as Section } from '@agent-remote-control/protocol/artifact';
import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { SECTION_LABELS } from '../../artifacts/artifact-labels.js';
import { Markdown } from '../entries/markdown.js';
import { IconButton } from '../icon-button.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';


/**
 * One section of an artifact, read as Markdown and edited in place. Saving an empty text clears the section;
 * `startEditing` opens a section that has no text yet.
 */
export function ArtifactSectionCard({ section, text, onSave, startEditing = false, onClose }: {
  readonly section: Section;
  readonly text: string;
  readonly onSave: (text: string) => Promise<boolean>;
  readonly startEditing?: boolean;
  readonly onClose?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(startEditing ? text : null);
  const [saving, setSaving] = useState(false);
  const label = SECTION_LABELS[section];
  const headingId = `section-${section}`;

  const close = () => {
    setDraft(null);
    onClose?.();
  };
  const save = async (text: string) => {
    setSaving(true);
    const saved = await onSave(text.trim());
    setSaving(false);
    if (saved) {
      close();
    }
  };

  return (
    <section aria-labelledby={headingId} className="group/section flex flex-col gap-2 rounded-2xl border bg-card px-4 py-3">
      <header className="flex items-center gap-2">
        <h3 id={headingId} className="font-heading text-sm font-semibold">{label}</h3>
        {draft === null && (
          <IconButton
            variant="ghost"
            size="icon-xs"
            label={`Edit ${label}`}
            onClick={() => setDraft(text)}
            className="ml-auto opacity-60 group-hover/section:opacity-100 focus-visible:opacity-100"
          >
            <Pencil />
          </IconButton>
        )}
      </header>
      {draft === null
        ? <Markdown text={text} />
        : (
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label={label}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              className="max-h-[60vh] min-h-32 font-mono text-[13px]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
              <Button size="sm" onClick={() => void save(draft)} disabled={saving}>Save</Button>
            </div>
          </div>
        )}
    </section>
  );
}
