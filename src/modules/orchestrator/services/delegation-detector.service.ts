import { Injectable } from '@nestjs/common';


export type DelegationResult = {
  readonly delegateToRole: string;
  readonly projectName: string | undefined;
  readonly taskSpec: string;
};

export type CeoDecision =
  | { readonly kind: 'delegate'; readonly delegation: DelegationResult }
  | { readonly kind: 'done'; readonly summary: string }
  | { readonly kind: 'direct_response' }
  | { readonly kind: 'invalid'; readonly reason: string };

const MARKER_LINE = /^[ \t]*[*_`]*\[(DELEGATE|DONE)([^\]\n]*)\][*_`]*[ \t]*$/gim;
const MARKER_MENTION = /\[(?:DELEGATE|DONE)\b/i;
const DELEGATE_ARGUMENTS = /^:([A-Za-z][\w-]*)(?::([^\s:]+))?$/;

@Injectable()
export class DelegationDetectorService {
  detect(response: string): CeoDecision {
    const markers = [...response.matchAll(MARKER_LINE)];

    if (markers.length === 0) {
      return MARKER_MENTION.test(response)
        ? { kind: 'invalid', reason: 'The marker must be alone on its own line, with no other text on that line.' }
        : { kind: 'direct_response' };
    }

    if (markers.length > 1) {
      return { kind: 'invalid', reason: 'The response contains more than one marker. Use exactly one marker per response.' };
    }

    const marker = markers[0]!;
    const body = this.removeMarker(response, marker);
    const [, name, args] = marker;

    if (name!.toUpperCase() === 'DONE') {
      return args
        ? { kind: 'invalid', reason: `Malformed done marker "${marker[0].trim()}". Use exactly [DONE].` }
        : { kind: 'done', summary: body };
    }

    const delegateArgs = args!.match(DELEGATE_ARGUMENTS);
    if (!delegateArgs) {
      return {
        kind: 'invalid',
        reason: `Malformed delegation marker "${marker[0].trim()}". Use [DELEGATE:ROLE:project-folder] or [DELEGATE:ROLE].`,
      };
    }

    if (!body) {
      return { kind: 'invalid', reason: 'The delegation has no task specification. Write the task before the marker.' };
    }

    return {
      kind: 'delegate',
      delegation: {
        delegateToRole: delegateArgs[1]!.toUpperCase(),
        projectName: delegateArgs[2],
        taskSpec: body,
      },
    };
  }

  private removeMarker(text: string, match: RegExpExecArray): string {
    const before = text.slice(0, match.index).trim();
    const after = text.slice(match.index + match[0].length).trim();
    return [before, after].filter(Boolean).join('\n\n');
  }
}
