import { z } from 'zod';

import { MAX_ATTACHMENT_NAME_LENGTH, MAX_ATTACHMENT_PATH_LENGTH } from './limits.js';


/** A file uploaded to the workspace; `path` is relative to the workspace base directory. */
export const attachmentSchema = z.object({
  path: z.string().min(1).max(MAX_ATTACHMENT_PATH_LENGTH),
  name: z.string().min(1).max(MAX_ATTACHMENT_NAME_LENGTH),
});
export type Attachment = z.infer<typeof attachmentSchema>;
