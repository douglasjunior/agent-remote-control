import { Injectable } from '@nestjs/common';


export type DelegationSessionMode = 'resume' | 'new';

export type DelegationResult = {
  readonly delegateToRole: string;
  readonly projectName: string | undefined;
  readonly taskSpec: string;
  readonly sessionMode?: DelegationSessionMode;
};

export type CeoDecision =
  | { readonly kind: 'delegate'; readonly delegations: readonly DelegationResult[] }
  | { readonly kind: 'done'; readonly summary: string }
  | { readonly kind: 'direct_response' }
  | { readonly kind: 'invalid'; readonly reason: string };

type ParsedMarker = Omit<DelegationResult, 'taskSpec'> | { readonly invalid: string };

const MARKER_LINE = /^[ \t]*[*_`]*\[(DELEGATE|DONE)([^\]\n]*)\][*_`]*[ \t]*$/gim;
const MARKER_MENTION = /\[(?:DELEGATE|DONE)\b/i;
const DELEGATE_ARGUMENTS = /^:([A-Za-z][\w-]*)(?::([^\s:]*))?(?::([^\s:]+))?$/;

@Injectable()
export class DelegationDetectorService {
  detect(response: string): CeoDecision {
    const markers = [...response.matchAll(MARKER_LINE)];

    if (markers.length === 0) {
      return MARKER_MENTION.test(response)
        ? { kind: 'invalid', reason: 'The marker must be alone on its own line, with no other text on that line.' }
        : { kind: 'direct_response' };
    }

    if (markers.some(([, name]) => name!.toUpperCase() === 'DONE')) {
      return markers.length > 1
        ? { kind: 'invalid', reason: '[DONE] cannot be combined with other markers. Finish with [DONE] alone, or delegate without it.' }
        : this.detectDone(response, markers[0]!);
    }

    return markers.length === 1
      ? this.detectSingleDelegation(response, markers[0]!)
      : this.detectParallelDelegations(response, markers);
  }

  private detectDone(response: string, marker: RegExpExecArray): CeoDecision {
    return marker[2]
      ? { kind: 'invalid', reason: `Malformed done marker "${marker[0].trim()}". Use exactly [DONE].` }
      : { kind: 'done', summary: this.removeMarker(response, marker) };
  }

  /** Models sometimes write the specification after the marker, so a single delegation takes the text on both sides. */
  private detectSingleDelegation(response: string, marker: RegExpExecArray): CeoDecision {
    const parsed = this.parseDelegateMarker(marker);
    if ('invalid' in parsed) {
      return { kind: 'invalid', reason: parsed.invalid };
    }

    const taskSpec = this.removeMarker(response, marker);
    if (!taskSpec) {
      return { kind: 'invalid', reason: 'The delegation has no task specification. Write the task before the marker.' };
    }

    return { kind: 'delegate', delegations: [{ ...parsed, taskSpec }] };
  }

  private detectParallelDelegations(response: string, markers: readonly RegExpExecArray[]): CeoDecision {
    const lastMarker = markers.at(-1)!;
    if (response.slice(lastMarker.index + lastMarker[0].length).trim()) {
      return {
        kind: 'invalid',
        reason: 'With several delegations, each task specification goes before its own marker and nothing follows the last marker.',
      };
    }

    const delegations: DelegationResult[] = [];
    let specStart = 0;
    for (const [position, marker] of markers.entries()) {
      const parsed = this.parseDelegateMarker(marker);
      if ('invalid' in parsed) {
        return { kind: 'invalid', reason: parsed.invalid };
      }

      const taskSpec = response.slice(specStart, marker.index).trim();
      if (!taskSpec) {
        return {
          kind: 'invalid',
          reason: `Delegation ${position + 1} ("${marker[0].trim()}") has no task specification. Write each task right before its own marker.`,
        };
      }

      delegations.push({ ...parsed, taskSpec });
      specStart = marker.index + marker[0].length;
    }

    return { kind: 'delegate', delegations };
  }

  private parseDelegateMarker(marker: RegExpExecArray): ParsedMarker {
    const delegateArgs = marker[2]!.match(DELEGATE_ARGUMENTS);
    if (!delegateArgs) {
      return {
        invalid: `Malformed delegation marker "${marker[0].trim()}". Use [DELEGATE:ROLE:project-folder:new], [DELEGATE:ROLE:project-folder], or [DELEGATE:ROLE].`,
      };
    }

    const [, rawRole, segment2, segment3] = delegateArgs;
    let projectName: string | undefined;
    let sessionMode: DelegationSessionMode | undefined;

    if (segment3 !== undefined) {
      const modeLower = segment3.toLowerCase();
      if (modeLower !== 'new' && modeLower !== 'resume') {
        return {
          invalid: `Malformed delegation marker "${marker[0].trim()}". Session mode must be "new" or "resume".`,
        };
      }
      sessionMode = modeLower;
      projectName = segment2 ? segment2 : undefined;
    } else if (segment2 !== undefined) {
      const seg2Lower = segment2.toLowerCase();
      if (seg2Lower === 'new' || seg2Lower === 'resume') {
        sessionMode = seg2Lower;
      } else {
        projectName = segment2;
      }
    }

    return {
      delegateToRole: rawRole!.toUpperCase(),
      projectName,
      ...(sessionMode ? { sessionMode } : {}),
    };
  }

  private removeMarker(text: string, match: RegExpExecArray): string {
    const before = text.slice(0, match.index).trim();
    const after = text.slice(match.index + match[0].length).trim();
    return [before, after].filter(Boolean).join('\n\n');
  }
}
