/** What became of a delegation to an agent already at work, told to the CEO with its next prompt. */
export type AgentReceiptKind = 'steered' | 'kept' | 'interrupted' | 'follow_up' | 'waiting' | 'replaced';

const RECEIPTS: Readonly<Record<AgentReceiptKind, string>> = {
  steered: 'Your instruction reached the agent in the middle of its current prompt. Its result answers it.',
  kept: 'The agent was between prompts, so your instruction goes with its next prompt, in the same session. Its result answers it.',
  interrupted: 'The agent\'s current prompt was cancelled, and your instruction is its next prompt, in the same session. Its result answers it.',
  follow_up: 'The agent finishes its current work first; your instruction then runs in the same session, and you get both results.',
  waiting: 'The agent finishes its current work first; this delegation starts after it, and you get both results.',
  replaced: 'This work stopped where it stood to start your new delegation. What the agent changed in the project stays as it left it.',
};

export function buildAgentReceipt(kind: AgentReceiptKind): string {
  return RECEIPTS[kind];
}

/** The result of a follow-up the agent never ran, because its work ended first. */
export function buildUnrunFollowUpPrompt(howItEnded: string): string {
  return `The agent's work ended (${howItEnded}) before this instruction ran. Delegate it again if it still applies.`;
}
