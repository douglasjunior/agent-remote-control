import type { TurnAttachment } from '../models/turn-attachment.model.js';


/** The files the user sent, listed before the message, for the CEO to inspect. */
export function buildAttachmentsPrompt(prompt: string, attachments?: readonly TurnAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return prompt;
  }
  const lines = attachments.map(
    attachment => `- Name: ${attachment.name}\n  Size: ${attachment.size} bytes\n  Type: ${attachment.contentType}\n  Path: ${attachment.path}`,
  );
  return `[ATTACHMENTS]\n${lines.join('\n')}\nInspect these files using your available tools as needed.\n\n${prompt}`;
}
