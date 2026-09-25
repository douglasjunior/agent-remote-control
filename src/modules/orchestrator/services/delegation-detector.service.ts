import { Injectable } from '@nestjs/common';


export type DelegationResult = {
  readonly delegateToRole: string;
  readonly projectName: string | undefined;
  readonly taskSpec: string;
};

export type CeoDecision =
  | { readonly kind: 'delegate'; readonly delegation: DelegationResult }
  | { readonly kind: 'done'; readonly summary: string }
  | { readonly kind: 'direct_response' };

@Injectable()
export class DelegationDetectorService {
  detect(response: string): CeoDecision {
    const trimmed = response.trim();
    const delegateMatch = trimmed.match(/\[DELEGATE:([^\]:]+)(?::([^\]]+))?\]$/);
    if (delegateMatch) {
      const delegateToRole = delegateMatch[1]!;
      const projectName = delegateMatch[2];
      const taskSpec = trimmed.substring(0, delegateMatch.index).trim();
      return {
        kind: 'delegate',
        delegation: {
          delegateToRole,
          projectName,
          taskSpec,
        },
      };
    }

    const doneMatch = trimmed.match(/\[DONE\]$/);
    if (doneMatch) {
      const summary = trimmed.substring(0, doneMatch.index).trim();
      return {
        kind: 'done',
        summary,
      };
    }

    return { kind: 'direct_response' };
  }
}
