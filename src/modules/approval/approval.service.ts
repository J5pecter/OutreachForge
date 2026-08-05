import { randomBytes } from 'node:crypto';
import { prisma } from '../../db';
import { config } from '../../config';
import { HttpError } from '../../lib/http';
import { getMailProvider } from '../sending/provider';
import { enqueueCampaign } from '../sending/dispatcher';

function approvalUrl(token: string): string {
  return `${config.publicBaseUrl}/approve/${token}`;
}

/** Deliver the approve link to the operator's phone (Telegram → email → log). */
async function notify(campaignName: string, url: string): Promise<'telegram' | 'email' | 'logged'> {
  const { telegramBotToken, telegramChatId, email } = config.approval;
  const text = `OutreachForge: campaign "${campaignName}" is ready to send.\nApprove & send: ${url}`;

  if (telegramBotToken && telegramChatId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text, disable_web_page_preview: true }),
      });
      if (res.ok) return 'telegram';
    } catch {
      /* fall through to email/log */
    }
  }

  if (email) {
    await getMailProvider().send({
      to: email,
      from: `${config.mail.fromName} <${config.mail.fromEmail}>`,
      subject: `Approve send: ${campaignName}`,
      html: `<p>Campaign "<strong>${campaignName}</strong>" is ready.</p><p><a href="${url}">Approve &amp; send</a></p>`,
      text,
    });
    return 'email';
  }

  // eslint-disable-next-line no-console
  console.log(`[approval] ${campaignName} — approve link: ${url}`);
  return 'logged';
}

/** Mark a campaign as needing mobile approval and send the link. */
export async function requestApproval(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  if (!['DRAFT', 'QUEUED'].includes(campaign.status)) {
    throw new HttpError(409, `Campaign is ${campaign.status}; request approval before it starts sending`);
  }

  const token = randomBytes(24).toString('base64url');
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      approvalRequired: true,
      approvalToken: token,
      approvalRequestedAt: new Date(),
      approvedAt: null, // re-requesting resets any prior approval
    },
  });

  const url = approvalUrl(token);
  const via = await notify(campaign.name, url);
  return { approvalUrl: url, notifiedVia: via };
}

/**
 * Approve by token (the phone taps this). Records approval and immediately
 * enqueues a first batch so sending starts on tap. Idempotent.
 */
export async function approveByToken(token: string) {
  const campaign = await prisma.campaign.findUnique({ where: { approvalToken: token } });
  if (!campaign) throw new HttpError(404, 'Approval link not recognised');

  if (!campaign.approvedAt) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { approvedAt: new Date() } });
  }
  // If it's already queued with prepared recipients, start sending now.
  let enqueued = 0;
  if (['QUEUED', 'SENDING'].includes(campaign.status)) {
    const res = await enqueueCampaign(campaign.id, config.policy.campaignMaxRecipients).catch(() => null);
    enqueued = res?.enqueued ?? 0;
  }
  return { campaignId: campaign.id, name: campaign.name, status: campaign.status, enqueued };
}

/** Guard used by the dispatch paths: block sends until approved (when required). */
export function assertApproved(campaign: { approvalRequired: boolean; approvedAt: Date | null }) {
  if (campaign.approvalRequired && !campaign.approvedAt) {
    throw new HttpError(409, 'Campaign is awaiting mobile approval — tap the approve link first.');
  }
}
