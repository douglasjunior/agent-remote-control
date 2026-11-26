/** The bot's name, and the server's when one was asked for, or why the test failed, in words for the user. */
export type DiscordConnectionTest =
  | { readonly ok: true; readonly botName: string; readonly guildName?: string }
  | { readonly ok: false; readonly error: string };
