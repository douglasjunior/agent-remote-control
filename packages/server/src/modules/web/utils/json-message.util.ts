/** A transport message as parsed JSON, or as the raw text when it is not JSON; validating it belongs to the handler. */
export function parseJsonMessage(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
