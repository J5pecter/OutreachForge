import { z } from 'zod';

export const consentBasisEnum = z.enum([
  'OPT_IN',
  'EXISTING_CUSTOMER',
  'CONTRACT',
  'LEGITIMATE_INTEREST',
  'IMPORTED_WITH_CONSENT',
]);

// Every lead MUST arrive with a lawful basis for contact. There is no path to
// create a lead without consent metadata — this is the core policy of the system.
export const leadInputSchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),

  consentBasis: consentBasisEnum,
  consentSource: z.string().trim().min(1, 'consentSource is required (where consent came from)'),
  consentAt: z.coerce.date().default(() => new Date()),
  consentNote: z.string().trim().optional(),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

export const ingestSchema = z.object({
  // Shared consent metadata applied to every row that does not specify its own.
  defaults: z
    .object({
      consentBasis: consentBasisEnum.optional(),
      consentSource: z.string().trim().min(1).optional(),
      consentAt: z.coerce.date().optional(),
      consentNote: z.string().trim().optional(),
    })
    .default({}),
  leads: z.array(leadInputSchema.partial({ consentBasis: true, consentSource: true })).min(1),
});
