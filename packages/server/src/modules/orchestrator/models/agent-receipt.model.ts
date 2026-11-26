/** An `<agent_result>` receipt waiting for the CEO, with the place it arrived in, which it keeps when given back. */
export type AgentReceipt = {
  readonly order: number;
  readonly text: string;
};
