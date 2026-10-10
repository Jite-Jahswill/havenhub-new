import { z } from 'zod';

/** What the HavenHub assistant understood a question to be about. */
export const ASSISTANT_INTENTS = [
  'GREETING',
  'THANKS',
  'CAPABILITIES',
  'HANDOFF',
  'REFUND_STATUS',
  'BOOKING_STATUS',
  'PROPERTY_SEARCH',
  'EXPERIENCE_SEARCH',
  'FAQ',
  'UNKNOWN',
] as const;
export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

export const assistantAskSchema = z
  .object({ text: z.string().trim().min(1, 'Type a question').max(500) })
  .strict();
export type AssistantAskInput = z.input<typeof assistantAskSchema>;

/** "Talk to a person": the last question and a short transcript go to support. */
export const assistantHandoffSchema = z
  .object({
    question: z.string().trim().max(500).optional(),
    transcript: z
      .array(
        z
          .object({ from: z.enum(['user', 'assistant']), text: z.string().trim().max(1000) })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();
export type AssistantHandoffInput = z.input<typeof assistantHandoffSchema>;

export const assistantQuestionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Only the questions the assistant could not answer. */
  unanswered: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(true),
});
