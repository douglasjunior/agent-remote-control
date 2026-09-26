export type DelegationEvent = {
  readonly phase: 'started' | 'finished';
  readonly round: number;
  readonly role: string;
  readonly roleName: string;
  readonly projectName?: string;
};
