import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { suppress } from '../suppression/suppression.service';

// A normalised event coming from any ESP, after provider-specific parsing.
export type EspEvent =
  | { kind: 'delivered'; email: string; messageId?: string; meta?: object }
  | { kind: 'open'; email: string; messageId?: string; meta?: object }
  | { kind: 'click'; email: string; messageId?: string; meta?: object }
  | { kind: 'bounce'; email: string; messageId?: string; hard: boolean; meta?: object }
  | { kind: 'complaint'; email: string; messageId?: string; meta?: object }
  | { kind: 'unsubscribe'; email: string; messageId?: string; meta?: object };

/**
 * Resolve the CampaignRecipient an event belongs to. Prefer the provider
 * message id (exact), fall back to the most recent recipient for that address.
 */
async function findRecipient(email: string, messageId?: string) {
  if (messageId) {
    const byMsg = await prisma.campaignRecipient.findFirst({ where: { messageId } });
    if (byMsg) return byMsg;
  }
  return prisma.campaignRecipient.findFirst({
    where: { lead: { email: email.trim().toLowerCase() } },
    orderBy: { sentAt: 'desc' },
  });
}

/**
 * Apply one ESP event. Bounces (hard) and complaints suppress the address
 * permanently — this is how the system honors deliverability signals without a
 * human in the loop. Opens/clicks/deliveries are recorded for analytics only.
 */
export async function applyEspEvent(ev: EspEvent): Promise<void> {
  const recipient = await findRecipient(ev.email, ev.messageId);

  // Suppress first — this must happen even if we can't tie the event to a
  // specific recipient (e.g. message id unknown), so a complaint always sticks.
  if (ev.kind === 'complaint') {
    await suppress(ev.email, 'COMPLAINT', 'ESP complaint webhook');
  } else if (ev.kind === 'bounce' && ev.hard) {
    await suppress(ev.email, 'BOUNCE', 'ESP hard-bounce webhook');
  } else if (ev.kind === 'unsubscribe') {
    await suppress(ev.email, 'UNSUBSCRIBE', 'ESP unsubscribe webhook');
  }

  if (!recipient) return;

  const data: Prisma.CampaignRecipientUpdateInput = {
    events: { create: { type: ev.kind, meta: (ev.meta ?? {}) as Prisma.InputJsonValue } },
  };
  if (ev.kind === 'bounce' && ev.hard) data.status = 'BOUNCED';
  if (ev.kind === 'complaint' || ev.kind === 'unsubscribe') data.status = 'UNSUBSCRIBED';
  if (ev.kind === 'open' && !recipient.openedAt) {
    if (recipient.status === 'SENT') data.status = 'OPENED';
    data.openedAt = new Date();
  }

  await prisma.campaignRecipient.update({ where: { id: recipient.id }, data });
}

export async function applyEspEvents(events: EspEvent[]): Promise<{ applied: number }> {
  let applied = 0;
  for (const ev of events) {
    await applyEspEvent(ev);
    applied += 1;
  }
  return { applied };
}
