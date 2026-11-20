import type { TeamMember } from '../../conversations/team-state.js';


export interface SquadStatus {
  /** Whether anyone works or waits for the user. */
  readonly live: boolean;
  readonly text: string;
  readonly working: number;
}

export function squadStatus(members: readonly TeamMember[]): SquadStatus {
  const working = members.filter(member => member.state === 'working').length;
  const waiting = members.some(member => member.state === 'waiting');
  const stopped = members.filter(member => member.interruptedWorkId !== undefined).length;
  const parts = [
    ...(working > 0 ? [`${working} working`] : []),
    ...(waiting ? ['needs your answer'] : []),
    ...(stopped > 0 ? [`${stopped} stopped`] : []),
  ];

  if (working === 0 && !waiting && stopped > 0) {
    return { live: false, text: parts[0]!, working };
  }
  if (parts.length > 0) {
    return { live: true, text: parts.join(' · '), working };
  }
  if (members.some(member => member.state === 'failed')) {
    return { live: false, text: 'Something failed', working };
  }
  const delivered = members.some(member => member.role === 'CEO' && member.state === 'done');
  return { live: false, text: delivered ? 'Answer delivered' : 'Ready', working };
}

/** Whether an agent waits for the user or has work a restart stopped, which a collapsed panel must not hide. */
export function squadNeedsAttention(members: readonly TeamMember[]): boolean {
  return members.some(member => member.state === 'waiting' || member.interruptedWorkId !== undefined);
}
