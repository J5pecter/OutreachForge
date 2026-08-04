import { prisma } from '../../db';
import { getMailProvider } from './provider';
import {
  htmlToText,
  listUnsubscribeHeaders,
  withHtmlFooter,
  withOpenPixel,
  withTextFooter,
} from './compliance';
import { isSuppressed } from '../suppression/suppression.service';

export type SendOutcome = {
  campaignId: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED_SUPPRESSED' | 'ALREADY_HANDLED';
};

/**
 * Send exactly one recipient. This is the unit of work the queue worker runs, so
 * every guard is re-evaluated at the moment of sending — not at enqueue time:
 *   - idempotency: only QUEUED recipients are sent (a retried/duplicated job is a no-op),
 *   - the message must have been pre-rendered,
 *   - the address must not be suppressed (someone may have unsubscribed since enqueue).
 *
 * Provider exceptions propagate so the worker can retry per the job's attempts.
 */
export async function sendOneRecipient(recipientId: string): Promise<SendOutcome> {
  const r = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { lead: true, campaign: true },
  });
  if (!r) return { campaignId: '', status: 'ALREADY_HANDLED' };
  if (r.status !== 'QUEUED') return { campaignId: r.campaignId, status: 'ALREADY_HANDLED' };

  if (!r.renderedHtml || !r.renderedSubject) {
    await prisma.campaignRecipient.update({
      where: { id: r.id },
      data: { status: 'FAILED', error: 'Recipient was not rendered before dispatch' },
    });
    return { campaignId: r.campaignId, status: 'FAILED' };
  }

  if (await isSuppressed(r.lead.email)) {
    await prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: 'SKIPPED_SUPPRESSED' } });
    return { campaignId: r.campaignId, status: 'SKIPPED_SUPPRESSED' };
  }

  const senderNote = `${r.campaign.fromName} contacted you`;
  const html = withOpenPixel(withHtmlFooter(r.renderedHtml, r.token, senderNote), r.token);
  const text = withTextFooter(htmlToText(r.renderedHtml), r.token, senderNote);

  // Provider exceptions intentionally bubble up to the worker for retry.
  const result = await getMailProvider().send({
    to: r.lead.email,
    from: `${r.campaign.fromName} <${r.campaign.fromEmail}>`,
    replyTo: r.campaign.replyTo ?? undefined,
    subject: r.renderedSubject,
    html,
    text,
    headers: listUnsubscribeHeaders(r.token),
  });

  await prisma.campaignRecipient.update({
    where: { id: r.id },
    data: {
      status: result.accepted ? 'SENT' : 'FAILED',
      messageId: result.messageId,
      sentAt: new Date(),
      error: result.accepted ? null : 'Provider did not accept the message',
      events: { create: { type: 'sent', meta: { messageId: result.messageId } } },
    },
  });

  return { campaignId: r.campaignId, status: result.accepted ? 'SENT' : 'FAILED' };
}

/** Mark a recipient permanently failed after the worker exhausts retries. */
export async function markRecipientFailed(recipientId: string, message: string): Promise<string | null> {
  const r = await prisma.campaignRecipient.findUnique({ where: { id: recipientId }, select: { id: true, campaignId: true } });
  if (!r) return null;
  await prisma.campaignRecipient.update({
    where: { id: r.id },
    data: { status: 'FAILED', error: message, events: { create: { type: 'error', meta: { message } } } },
  });
  return r.campaignId;
}

/** When no recipients remain QUEUED, flip a SENDING campaign to COMPLETED. */
export async function maybeCompleteCampaign(campaignId: string): Promise<void> {
  if (!campaignId) return;
  const remaining = await prisma.campaignRecipient.count({ where: { campaignId, status: 'QUEUED' } });
  if (remaining > 0) return;
  await prisma.campaign.updateMany({
    where: { id: campaignId, status: 'SENDING' },
    data: { status: 'COMPLETED' },
  });
}
