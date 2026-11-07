import type { Attachment } from '@agent-remote-control/protocol/attachment';
import { Square } from 'lucide-react';

import { IconButton } from './icon-button.js';
import { PromptInput } from './prompt-input/prompt-input.js';
import { usePromptInput } from './prompt-input/use-prompt-input.js';


export function Composer({ conversationId, initialText = '', disabled, running, onSend, onStop }: {
  readonly conversationId: string;
  readonly initialText?: string;
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onSend: (text: string, attachments: readonly Attachment[]) => void;
  readonly onStop: () => void;
}) {
  const input = usePromptInput({ conversationId, initialText, disabled, onSubmit: onSend });

  return (
    <div className="border-t p-3">
      <div className="mx-auto w-full max-w-[640px]">
        <PromptInput
          input={input}
          label="Message"
          placeholder="Message the agents…"
          submitLabel="Send"
          actions={running && (
            <IconButton variant="outline" label="Stop" onClick={onStop}>
              <Square />
            </IconButton>
          )}
        />
      </div>
    </div>
  );
}
