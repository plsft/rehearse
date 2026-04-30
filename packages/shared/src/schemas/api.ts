import { z } from 'zod';

export const repoRefSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  installationId: z.number().int().positive(),
});

export const confidenceWeightsSchema = z.object({
  testHealth: z.number().min(0).max(100),
  scopeContainment: z.number().min(0).max(100),
  reviewDepth: z.number().min(0).max(100),
  agentTrust: z.number().min(0).max(100),
  sizeDiscipline: z.number().min(0).max(100),
  provenanceQuality: z.number().min(0).max(100),
});

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
