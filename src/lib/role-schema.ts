import { z } from "zod";

export const roleInput = z.object({
  name: z.string().trim().min(1).max(48),
  description: z.string().trim().max(240).default(""),
  currentLevel: z.string().trim().min(1).max(48),
  goal: z.string().trim().min(1).max(500),
  focusAreas: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  answerLanguage: z.enum(["zh-CN", "en", "bilingual"]),
  explanationDepth: z.enum(["brief", "standard", "detailed"]),
  tone: z.enum(["direct", "teacher", "concise"]),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
  customInstructions: z.string().trim().max(2000).default(""),
  isDefault: z.boolean().default(false),
});
