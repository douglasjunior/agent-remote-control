export type PlanDocumentName = 'intent.md' | 'plan.md';

export function buildPlanDocumentInstructions(documentName: PlanDocumentName): string {
  return `### Plan Documents
Your deliverable is a file, so the caller refers to it by path and never has to repeat its content.
- The \`[PLANS_DIRECTORY]\` block of your prompt gives the folder for this task. Each initiative has its own folder inside it, named \`<YYYY-MM-DD>-<short-slug>\`, which holds \`intent.md\` (written by the Product Owner) and \`plan.md\` (written by the Tech Lead).
- When the task points to a document of an initiative, use that initiative's folder. Otherwise create a new one.
- The only file you may write is \`${documentName}\`. Refining a document you already delivered updates the same file in place.
- Your final response gives the caller the absolute path of \`${documentName}\`, a short summary of what you wrote or changed, and what the caller must decide or do next. It does not repeat the document.`;
}

export function buildPlanDocumentReminder(documentName: PlanDocumentName): string {
  return `- Your deliverable is \`${documentName}\`, in an initiative folder inside the \`[PLANS_DIRECTORY]\` folder (update it in place when refining), and it is the only file you may write. End with its absolute path and a short summary, never the whole document.`;
}
