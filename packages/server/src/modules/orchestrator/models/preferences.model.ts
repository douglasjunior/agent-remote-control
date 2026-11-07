/** Global to the instance: the same preferences apply to every conversation and channel. */
export type Preferences = {
  /** Language of the text agents write for the user, as a language name such as "Brazilian Portuguese". */
  readonly language?: string;
  readonly updatedAt?: string;
};
