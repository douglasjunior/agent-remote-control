export type ShellCommandResult = {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
};
