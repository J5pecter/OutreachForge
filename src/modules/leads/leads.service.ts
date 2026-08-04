import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { HttpError } from '../../lib/http';
import { leadInputSchema, type LeadInput } from './leads.schema';

export type IngestResult = {
  received: number;
  created: number;
  updated: number;
  skippedSuppressed: number;
  errors: { index: number; email?: string; message: string }[];
};

type RawLead = Partial<LeadInput> & Record<string, unknown>;

/**
 * Ingest a batch of leads.
 *
 * - Merges per-batch `defaults` consent metadata into each row.
 * - Validates every row (a lead with no lawful basis is rejected, not stored).
 * - Deduplicates by email: existing leads are updated, not duplicated.
 * - Refuses any address currently on the suppression list (unsubscribed /
 *   bounced / complained) — those people stay off the list permanently.
 */
export async function ingestLeads(
  rows: RawLead[],
  defaults: Partial<Pick<LeadInput, 'consentBasis' | 'consentSource' | 'consentAt' | 'consentNote'>>,
): Promise<IngestResult> {
  const result: IngestResult = {
    received: rows.length,
    created: 0,
    updated: 0,
    skippedSuppressed: 0,
    errors: [],
  };

  // Validate + normalise first so we can dedupe within the batch and hit the DB once.
  const valid: { index: number; lead: LeadInput }[] = [];
  rows.forEach((row, index) => {
    const merged = {
      ...row,
      consentBasis: row.consentBasis ?? defaults.consentBasis,
      consentSource: row.consentSource ?? defaults.consentSource,
      consentAt: row.consentAt ?? defaults.consentAt,
      consentNote: row.consentNote ?? defaults.consentNote,
    };
    const parsed = leadInputSchema.safeParse(merged);
    if (!parsed.success) {
      result.errors.push({
        index,
        email: typeof row.email === 'string' ? row.email : undefined,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }
    valid.push({ index, lead: parsed.data });
  });

  if (valid.length === 0) return result;

  // Collapse duplicates within the batch (last row wins).
  const byEmail = new Map<string, { index: number; lead: LeadInput }>();
  for (const v of valid) byEmail.set(v.lead.email, v);

  const emails = [...byEmail.keys()];
  const suppressed = new Set(
    (
      await prisma.suppression.findMany({
        where: { email: { in: emails } },
        select: { email: true },
      })
    ).map((s) => s.email),
  );

  for (const [email, { lead }] of byEmail) {
    if (suppressed.has(email)) {
      result.skippedSuppressed += 1;
      continue;
    }
    const data = {
      email: lead.email,
      firstName: lead.firstName ?? null,
      lastName: lead.lastName ?? null,
      company: lead.company ?? null,
      title: lead.title ?? null,
      attributes: lead.attributes as Prisma.InputJsonValue,
      consentBasis: lead.consentBasis,
      consentSource: lead.consentSource,
      consentAt: lead.consentAt,
      consentNote: lead.consentNote ?? null,
    };
    const existing = await prisma.lead.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await prisma.lead.update({ where: { email }, data });
      result.updated += 1;
    } else {
      await prisma.lead.create({ data });
      result.created += 1;
    }
  }

  return result;
}

export async function listLeads(params: { limit: number; cursor?: string; status?: string }) {
  const leads = await prisma.lead.findMany({
    where: params.status ? { status: params.status as never } : undefined,
    take: params.limit + 1,
    ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
    orderBy: { createdAt: 'desc' },
  });
  const hasMore = leads.length > params.limit;
  const page = hasMore ? leads.slice(0, params.limit) : leads;
  return { leads: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

export async function getLead(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new HttpError(404, 'Lead not found');
  return lead;
}
