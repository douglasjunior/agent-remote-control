const ESCAPE = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
const ANSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-9;?]*[ -/]*[@-~]|${ESCAPE}\\][^${BELL}]*${BELL}`, 'g');

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, '');
}
