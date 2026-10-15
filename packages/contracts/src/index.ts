import { z } from "zod";

export const episodeModes = ["news", "explainer", "custom"] as const;
export const episodeStates = ["queued", "researching", "writing", "checking", "awaiting_approval", "voicing", "assembling", "ready", "failed", "cancelled", "deleting"] as const;
export const presentationStyles = ["balanced", "lively", "deeper", "concise"] as const;
export const jobStates = ["queued", "running", "retry_wait", "awaiting_approval", "completed", "failed", "cancelled"] as const;
export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });
export const createEpisodeSchema = z.object({
  mode: z.enum(episodeModes),
  prompt: z.string().trim().min(10).max(10_000),
  targetMinutes: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(45), z.literal(60)]),
  primaryPersonaId: uuid,
  secondaryPersonaId: uuid.optional(),
  language: z.string().min(2).max(32).default("English"),
  freshnessHours: z.number().int().min(1).max(720).default(24),
  sourceUrls: z.array(z.string().url().startsWith("https://")).max(5).default([]),
  sourceNotes: z.string().max(50_000).default(""),
  voiceProfile: z.enum(["latest", "economy"]).default("latest"),
  interactionEnabled: z.boolean().default(true)
}).superRefine((v, ctx) => {
  if (v.secondaryPersonaId && v.secondaryPersonaId === v.primaryPersonaId) ctx.addIssue({code:"custom", message:"Choose two different hosts", path:["secondaryPersonaId"]});
});
export type CreateEpisode = z.infer<typeof createEpisodeSchema>;

export const personaSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).default(""),
  instructions: z.string().max(3000).default(""),
  tone: z.string().max(80).default("calm"),
  pace: z.string().max(80).default("natural"),
  voiceId: z.string().max(128).nullable().default(null),
  voiceSettings: z.record(z.number()).default({}),
  active: z.boolean().default(true)
});

export const settingsPatchSchema = z.object({
  stylePreference: z.enum(presentationStyles).optional(),
  defaultPersonaId: uuid.nullable().optional(),
  defaultLanguage: z.string().min(2).max(32).optional(),
  defaultMinutes: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(45), z.literal(60)]).optional(),
  playbackSpeed: z.number().min(0.8).max(1.5).optional(),
  interactionEnabled: z.boolean().optional(),
  autoResume: z.boolean().optional(),
  retainRecordings: z.boolean().optional(),
  episodeBudgetUsd: z.number().min(0).max(1000).optional(),
  answerBudgetUsd: z.number().min(0).max(100).optional(),
  monthlyBudgetUsd: z.number().min(0).max(10000).optional(),
  voiceUsdPerThousandCharacters: z.number().positive().max(10).nullable().optional()
}).strict();
export const progressSchema = z.object({positionMs:z.number().int().min(0), speed:z.number().min(0.8).max(1.5), deviceSessionId:uuid, expectedRevision:z.number().int().min(0)});
export const questionSchema = z.object({text:z.string().trim().min(2).max(2000), anchorMs:z.number().int().min(0), chapterId:uuid.nullable().default(null)});
export const jobCheckpointSchema = z.record(z.unknown());
export const internalClaimSchema = z.object({ workerId:z.string().min(1).max(128) });
export const internalLeaseSchema = z.object({leaseToken:uuid, fence:z.number().int().min(1)});

export function errorBody(code:string, message:string, retryable=false, requestId=crypto.randomUUID()) {
  return {error:{code,message,retryable,requestId}};
}
