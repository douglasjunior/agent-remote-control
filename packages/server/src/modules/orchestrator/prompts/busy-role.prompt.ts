/** Why a delegation to an agent already at work names no `on_busy`. */
export type BusyRoleReason = 'other_work' | 'no_steering' | 'unknown_steering';

const WHY: Readonly<Record<BusyRoleReason, string>> = {
  other_work: 'on other work than this delegation',
  no_steering: 'and its coding agent does not take a new instruction in the middle of a prompt',
  unknown_steering: 'and its coding agent has not said yet whether it takes a new instruction in the middle of a prompt',
};

/** `work` names what the agent is on: its artifact, or its project folder. */
export function buildBusyRoleRepair(role: string, work: string, reason: BusyRoleReason): string {
  const interrupt = reason === 'other_work'
    ? 'its current work ends where it stands (its task keeps its status and its changes stay in the project) and this delegation starts now, in its own session.'
    : 'its current prompt stops now and it goes on with your text as its next prompt in the same session, keeping what it learned; only the step it was in the middle of is cut short.';
  return [
    `${role} is already working ${work}, ${WHY[reason]}. Add on_busy to the <delegate> tag to say what happens to that work:`,
    '- on_busy="wait": this delegation runs once the current work delivers its result, and you get both results. Nothing is lost, but it waits that long.',
    `- on_busy="interrupt": ${interrupt}`,
  ].join('\n');
}
