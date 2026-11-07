/** Names the folder an agent may write its plan documents to, which lies outside the project folder it works in. */
export function buildPlansDirectoryPrompt(plansFolder: string): string {
  return [
    '[PLANS_DIRECTORY]',
    `Folder for this task: ${plansFolder}`,
    'Writing there is authorized as an exception to your working directory boundaries, and nothing else outside your working directory is.',
    '',
  ].join('\n');
}
