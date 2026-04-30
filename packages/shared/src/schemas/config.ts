import { z } from 'zod';

export const gitgateYmlSchema = z.object({
  version: z.literal(1),
  detection: z
    .object({
      enabled: z.boolean().default(true),
      label_format: z.string().default('agent:{provider}'),
      post_comment: z.boolean().default(true),
      exempt_bots: z.array(z.string()).default(['dependabot[bot]', 'renovate[bot]']),
      custom_agents: z
        .array(
          z.object({
            name: z.string(),
            match: z.object({
              committer_email: z.string().optional(),
              bot_username: z.string().optional(),
            }),
            treat_as: z.enum(['agent', 'bot']).default('agent'),
            provider: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
  confidence: z
    .object({
      enabled: z.boolean().default(true),
      minimum_score: z.number().min(0).max(100).optional(),
      apply_to_human_prs: z.boolean().default(true),
      weights: z
        .object({
          test_health: z.number().optional(),
          scope_containment: z.number().optional(),
          review_depth: z.number().optional(),
          agent_trust: z.number().optional(),
          size_discipline: z.number().optional(),
          provenance_quality: z.number().optional(),
        })
        .optional(),
      size_thresholds: z
        .object({
          excellent: z.number().default(200),
          good: z.number().default(500),
          acceptable: z.number().default(1000),
        })
        .optional(),
      scope_mappings: z.record(z.array(z.string())).optional(),
    })
    .optional(),
  provenance: z
    .object({
      enabled: z.boolean().default(true),
      post_summary_comment: z.boolean().default(true),
    })
    .optional(),
  agents: z
    .record(
      z.object({
        confidence_minimum: z.number().min(0).max(100).optional(),
      }),
    )
    .optional(),
});

export type GitGateYml = z.infer<typeof gitgateYmlSchema>;
