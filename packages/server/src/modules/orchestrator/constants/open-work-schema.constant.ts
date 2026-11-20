import { z } from 'zod';

import type { OpenWork } from '../models/open-work.model.js';


const userQuestionSchema = z.object({
  text: z.string(),
  rationale: z.string().optional(),
  options: z.array(z.string()),
  recommendedIndex: z.number().int().optional(),
});

const turnAttachmentSchema = z.object({
  name: z.string(),
  path: z.string(),
  contentType: z.string(),
  size: z.number(),
  url: z.string().optional(),
});

const answeredQuestionSchema = z.object({
  question: userQuestionSchema,
  answer: z.string(),
  optionNumber: z.number().int().optional(),
  timedOut: z.literal(true).optional(),
  attachments: z.array(turnAttachmentSchema).optional(),
});

/** An `OpenWork` record as stored, validated when read back. */
export const openWorkSchema: z.ZodType<OpenWork> = z.object({
  id: z.string(),
  role: z.string(),
  roleName: z.string(),
  projectName: z.string().nullable(),
  artifactId: z.string().optional(),
  summary: z.string(),
  taskSpec: z.string(),
  cwd: z.string(),
  round: z.number().int(),
  root: z.boolean(),
  questions: z.object({
    message: z.string(),
    questions: z.array(userQuestionSchema),
    answers: z.array(answeredQuestionSchema),
  }).optional(),
});
