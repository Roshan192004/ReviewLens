import { z } from "zod";
import { SENTIMENTS, TOPICS, SUMMARY_MAX_LENGTH } from "../config.js";

export const analysisSchema = z.strictObject({
  sentiment: z.enum(SENTIMENTS),
  topics: z.array(z.enum(TOPICS))
    .min(1)
    .transform((topics) => [...new Set(topics)]),
  summary: z.string()
    .trim()
    .min(1)
    .max(SUMMARY_MAX_LENGTH)
    .refine((summary) => !/[\r\n]/u.test(summary), {
      message: "must not contain line breaks",
    }),
  needs_reply: z.boolean(),
});

export const batchItemSchema = analysisSchema.extend({
  id: z.string().trim().min(1),
});
