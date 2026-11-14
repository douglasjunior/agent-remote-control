import type { AnsweredQuestion, UserQuestion } from './user-question.model.js';


export type OpenWorkQuestions = {
  readonly message: string;
  readonly questions: readonly UserQuestion[];
  readonly answers: readonly AnsweredQuestion[];
};

/** An agent's work in progress, kept on disk so that it outlives the server process running it. */
export type OpenWork = {
  readonly id: string;
  readonly role: string;
  readonly roleName: string;
  readonly projectName: string | null;
  /** The artifact the delegation held, which it takes again when resumed. */
  readonly artifactId?: string;
  readonly summary: string;
  /** The delegated task or, for the root agent, the prompt of its turn. */
  readonly taskSpec: string;
  readonly cwd: string;
  readonly round: number;
  /** Whether this is the agent the turn started on, whose round follows from the results of the others. */
  readonly root: boolean;
  readonly questions?: OpenWorkQuestions;
};

/** Work a restart stopped and the user can start again. */
export type InterruptedWork = Pick<OpenWork, 'id' | 'role' | 'roleName' | 'projectName' | 'summary'>;
