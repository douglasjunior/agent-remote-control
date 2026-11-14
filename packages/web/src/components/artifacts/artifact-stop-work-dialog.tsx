import type { ArtifactStatus, ArtifactSummary } from '@agent-remote-control/protocol/artifact';

import { STATUS_LABELS } from '../../artifacts/artifact-labels.js';
import { agentIdentity } from '../../lib/agent-identity.js';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog.js';


/** Confirms a move that stops the agent holding the artifact; the coordinator hears that the user stopped it. */
export function ArtifactStopWorkDialog({ artifact, status, onConfirm, onCancel }: {
  readonly artifact: ArtifactSummary;
  readonly status: ArtifactStatus;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const agent = artifact.assignee ? agentIdentity(artifact.assignee.role, artifact.assignee.roleName).label : 'An agent';
  return (
    <AlertDialog open onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Move ${artifact.id} to ${STATUS_LABELS[status]}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {`${agent} is working on it right now. Moving it stops the agent before it finishes, and the coordinator keeps the status you chose.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep working</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>Move and stop</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
