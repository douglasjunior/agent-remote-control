import type { ArtifactStatus, ArtifactSummary } from '@agent-remote-control/protocol/artifact';
import { Snowflake } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { STATUS_LABELS, UNFREEZE_STATUSES } from '../../artifacts/artifact-labels.js';
import { useBoard } from '../../artifacts/use-board.js';
import { useConnection } from '../../connection/connection-context.js';
import { Button } from '../ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { Label } from '../ui/label.js';
import { Textarea } from '../ui/textarea.js';

import { ChoiceSelect } from './choice-select.js';


/**
 * Gives a frozen task back to the team. Only the user can: the server froze it after too many delegations. An
 * instruction is kept on the task as a comment and sent to the coordinator in the chat, so the next round starts
 * from it.
 */
export function ArtifactUnfreezeDialog({ conversationId, artifact, open, onOpenChange, defaultStatus = 'ready' }: {
  readonly conversationId: string;
  readonly artifact: ArtifactSummary;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly defaultStatus?: ArtifactStatus;
}) {
  const { connection } = useConnection();
  const { updateArtifact, commentArtifact } = useBoard(conversationId);
  const [status, setStatus] = useState<ArtifactStatus>(UNFREEZE_STATUSES.includes(defaultStatus) ? defaultStatus : 'ready');
  const [instruction, setInstruction] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const moved = await updateArtifact(artifact.id, { status });
    const text = instruction.trim();
    if (moved.ok && text) {
      await commentArtifact(artifact.id, text);
      connection.send({
        type: 'message.send',
        conversationId,
        text: `Task ${artifact.id} "${artifact.title}" was unfrozen and moved to ${STATUS_LABELS[status]}. Instructions: ${text}`,
      });
    }
    setSaving(false);
    if (moved.ok) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Snowflake aria-hidden className="size-4 text-frozen" />
            {`Unfreeze ${artifact.id}`}
          </DialogTitle>
          <DialogDescription>
            {`"${artifact.title}" went through too many delegations and stopped. Choose where it goes back to; its delegation count starts over.`}
          </DialogDescription>
        </DialogHeader>
        <form id="artifact-unfreeze" onSubmit={event => void submit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Move to</span>
            <ChoiceSelect
              label="Move to"
              value={status}
              choices={UNFREEZE_STATUSES.map(value => ({ value, label: STATUS_LABELS[value] }))}
              onChange={value => setStatus(value as ArtifactStatus)}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="artifact-unfreeze-instruction">Instruction for the coordinator</Label>
            <Textarea
              id="artifact-unfreeze-instruction"
              value={instruction}
              onChange={event => setInstruction(event.target.value)}
              placeholder="Optional: what should change so the task does not get stuck again."
              className="max-h-48 min-h-20"
            />
            <span className="text-xs text-muted-foreground">Kept on the task as a comment and sent to the coordinator in the chat.</span>
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="artifact-unfreeze" disabled={saving}>Unfreeze</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
