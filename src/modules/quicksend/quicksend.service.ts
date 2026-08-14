import { prisma } from '../../db';
import { HttpError } from '../../lib/http';
import { ingestLeads } from '../leads/leads.service';
import { createCampaignSchema } from '../campaigns/campaigns.schema';
import { createCampaign, buildAudience, renderCampaign } from '../campaigns/campaigns.service';
import { enqueueCampaign } from '../sending/dispatcher';
import { config } from '../../config';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type QuickSendInput = {
  emails: string[];
  subject: string;
  body: string; // plain text; newlines become line breaks
  consented: boolean;
};

/**
 * The simple front door: paste emails + a message → each person gets their own
 * individual email, throttled, with an unsubscribe link. Still consent-gated:
 * the sender must attest the recipients agreed to hear from them, and anyone on
 * the suppression list is skipped. It's a thin wrapper over the normal pipeline.
 */
export async function quickSend(input: QuickSendInput) {
  if (!input.consented) {
    throw new HttpError(422, 'Confirm the recipients agreed to hear from you before sending.');
  }
  if (!input.subject.trim()) throw new HttpError(422, 'Subject is required.');
  if (!input.body.trim()) throw new HttpError(422, 'Message is required.');

  // Parse, normalise, dedupe, validate the pasted list.
  const raw = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const valid = raw.filter((e) => EMAIL_RE.test(e));
  const invalid = raw.filter((e) => !EMAIL_RE.test(e));
  if (valid.length === 0) throw new HttpError(422, 'No valid email addresses found.');

  // Record them with the sender's attestation as the lawful basis.
  const ingest = await ingestLeads(
    valid.map((email) => ({ email })),
    {
      consentBasis: 'IMPORTED_WITH_CONSENT',
      consentSource: 'Quick send — sender attested the recipients agreed to hear from them',
      consentAt: new Date(),
    },
  );

  const leads = await prisma.lead.findMany({
    where: { email: { in: valid }, status: 'ACTIVE' },
    select: { id: true },
  });
  if (leads.length === 0) {
    return { queued: 0, invalid, skippedSuppressed: ingest.skippedSuppressed, note: 'Everyone was suppressed or invalid.' };
  }

  // Plain message → minimal HTML (line breaks preserved). The unsubscribe footer
  // is appended automatically at send time.
  const bodyHtml = input.body.replace(/\r?\n/g, '<br>');
  const campaignInput = createCampaignSchema.parse({
    name: `Quick send — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    subjectTemplate: input.subject,
    bodyTemplate: bodyHtml,
  });
  const campaign = await createCampaign(campaignInput);

  await buildAudience(campaign.id, { leadIds: leads.map((l) => l.id) });
  const rendered = await renderCampaign(campaign.id);
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'QUEUED' } });
  const dispatched = await enqueueCampaign(campaign.id, config.policy.campaignMaxRecipients);

  return {
    campaignId: campaign.id,
    queued: dispatched.enqueued,
    perHour: dispatched.perHour,
    invalid,
    skippedSuppressed: ingest.skippedSuppressed,
    renderErrors: rendered.errors,
  };
}
