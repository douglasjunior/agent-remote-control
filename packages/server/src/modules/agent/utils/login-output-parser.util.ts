import type { AgentLoginEvent } from '../models/agent-auth.model.js';

import { stripAnsi } from './strip-ansi.util.js';

/** What a login prints: the events for the user, and a yes or no question the CLI asks on its own account. */
export type LoginOutput = AgentLoginEvent | { readonly kind: 'question'; readonly question: string };


const URL_PATTERN = /https:\/\/[^\s"'<>)\]]+/;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const CODE_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/;
const FAILURE_PATTERN = /error|fail|invalid|could not|couldn't|denied|expired|not found/i;
const CONFIRM_PATTERN = /[([](?:y\/n|y\/N|Y\/n)[)\]]/;
const REJECTED_CODE_PATTERN = /invalid code|malformed auth code|invalid_grant/gi;
const PROMPT_PATTERN = /paste (?:code|the authorization code|the code)/i;

/**
 * Reads the text a login CLI prints and reports the link to open, the one-time code and the prompt that
 * waits for a pasted code, or the yes or no question it asks. The CLIs print these without a trailing newline or in later chunks, so
 * detection runs on everything seen so far and each finding is reported once.
 */
export class LoginOutputParser {
  private text = '';
  private reportedUrl: string | undefined;
  private reportedCode: string | undefined;
  private reportedPrompt = false;
  private reportedConfirm = false;
  private reportedRejections = 0;

  feed(chunk: string): readonly LoginOutput[] {
    this.text += stripAnsi(chunk);
    const events: LoginOutput[] = [];

    const urlMatch = URL_PATTERN.exec(this.text);
    if (urlMatch) {
      const url = urlMatch[0].replace(TRAILING_PUNCTUATION, '');
      const afterUrl = this.text.slice(urlMatch.index + urlMatch[0].length);
      const code = CODE_PATTERN.exec(afterUrl)?.[0];
      if (url !== this.reportedUrl || code !== this.reportedCode) {
        this.reportedUrl = url;
        this.reportedCode = code;
        events.push(code ? { kind: 'url', url, code } : { kind: 'url', url });
      }
    }

    if (!this.reportedConfirm) {
      const confirmMatch = CONFIRM_PATTERN.exec(this.text);
      if (confirmMatch) {
        this.reportedConfirm = true;
        events.push({ kind: 'question', question: this.lineAround(confirmMatch.index) });
      }
    }

    if (!this.reportedPrompt) {
      const promptMatch = PROMPT_PATTERN.exec(this.text);
      if (promptMatch) {
        this.reportedPrompt = true;
        events.push({ kind: 'prompt', hint: this.lineAround(promptMatch.index) });
      }
    }
    const rejections = [...this.text.matchAll(REJECTED_CODE_PATTERN)];
    if (rejections.length > this.reportedRejections) {
      this.reportedRejections = rejections.length;
      events.push({ kind: 'prompt', hint: this.lineAround(rejections.at(-1)!.index) });
    }
    return events;
  }

  /**
   * Line for a failure message: the last one that reads like a failure, otherwise the last one that is
   * neither empty nor a link or a code. A crash prints a stack trace whose last line says nothing.
   */
  lastMessage(): string | undefined {
    const lines = this.text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !URL_PATTERN.test(line) && !CODE_PATTERN.test(line));
    return lines.findLast(line => FAILURE_PATTERN.test(line)) ?? lines.at(-1);
  }

  private lineAround(index: number): string {
    const start = this.text.lastIndexOf('\n', index) + 1;
    const end = this.text.indexOf('\n', index);
    return this.text.slice(start, end === -1 ? undefined : end).trim();
  }
}
