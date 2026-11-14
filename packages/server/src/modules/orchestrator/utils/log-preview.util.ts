const LOG_PREVIEW_LENGTH = 100;

/** A text on one line, cut for a log entry. */
export function previewForLog(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > LOG_PREVIEW_LENGTH ? `${singleLine.slice(0, LOG_PREVIEW_LENGTH)}...` : singleLine;
}
