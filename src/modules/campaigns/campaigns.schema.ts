import { z } from 'zod';
import { config } from '../../config';

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1),
  fromName: z.string().trim().min(1).default(config.mail.fromName),
  fromEmail: z.string().email().default(config.mail.fromEmail),
  replyTo: z.string().email().optional(),
  subjectTemplate: z.string().trim().min(1),
  // HTML body with {{merge}} fields. The unsubscribe footer is appended
  // automatically at render time — do not include your own. Place {{ai}} where
  // the per-recipient personalized sentence should go.
  bodyTemplate: z.string().trim().min(1),
  // Optional LLM personalization.
  aiEnabled: z.boolean().default(false),
  aiPrompt: z.string().trim().min(1).optional(),
  throttlePerHour: z.coerce
    .number()
    .int()
    .min(1)
    .max(config.policy.sendMaxPerHour)
    .default(Math.min(200, config.policy.sendMaxPerHour)),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

// Which consented leads to enrol. Defaults to all ACTIVE leads.
export const buildAudienceSchema = z.object({
  leadIds: z.array(z.string()).optional(),
  consentBasis: z
    .array(z.enum(['OPT_IN', 'EXISTING_CUSTOMER', 'CONTRACT', 'LEGITIMATE_INTEREST', 'IMPORTED_WITH_CONSENT']))
    .optional(),
});
