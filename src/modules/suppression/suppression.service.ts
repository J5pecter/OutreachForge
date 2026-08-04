import { prisma } from '../../db';

type Reason = 'UNSUBSCRIBE' | 'BOUNCE' | 'COMPLAINT' | 'MANUAL';

const REASON_TO_LEAD_STATUS: Record<Reason, 'UNSUBSCRIBED' | 'BOUNCED' | 'SUPPRESSED'> = {
  UNSUBSCRIBE: 'UNSUBSCRIBED',
  BOUNCE: 'BOUNCED',
  COMPLAINT: 'SUPPRESSED',
  MANUAL: 'SUPPRESSED',
};

/**
 * Permanently suppress an address. Idempotent. Once here, the address is never
 * ingested or sent to again. This is the single choke point that enforces
 * unsubscribe / bounce / complaint honouring across the whole system.
 */
export async function suppress(email: string, reason: Reason, note?: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await prisma.suppression.upsert({
    where: { email: normalized },
    create: { email: normalized, reason, note },
    update: { reason, note },
  });
  await prisma.lead.updateMany({
    where: { email: normalized },
    data: { status: REASON_TO_LEAD_STATUS[reason], unsubscribedAt: reason === 'UNSUBSCRIBE' ? new Date() : undefined },
  });
}

/** Return the subset of the given emails that are suppressed. */
export async function filterSuppressed(emails: string[]): Promise<Set<string>> {
  const rows = await prisma.suppression.findMany({
    where: { email: { in: emails.map((e) => e.trim().toLowerCase()) } },
    select: { email: true },
  });
  return new Set(rows.map((r) => r.email));
}

export async function isSuppressed(email: string): Promise<boolean> {
  const hit = await prisma.suppression.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  return hit !== null;
}
