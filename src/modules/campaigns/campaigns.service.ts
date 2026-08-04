import { prisma } from '../../db';
import { config } from '../../config';
import { HttpError } from '../../lib/http';
import { extractTokens, render } from '../../lib/template';
import { pMap } from '../../lib/pmap';
import { filterSuppressed } from '../suppression/suppression.service';
import { getPersonalizationProvider } from '../personalization/provider';
import type { CreateCampaignInput } from './campaigns.schema';

// {{ai}} is allowed to be empty during strict render (e.g. template-only mode).
const OPTIONAL_TOKENS = ['ai'];

export async function createCampaign(input: CreateCampaignInput) {
  // Validate templates up front by rendering against a sample context so a
  // broken merge field is caught at creation, not mid-send.
  const sample = { firstName: 'Sample', lastName: 'Lead', company: 'Acme', title: 'CTO', attributes: {}, ai: '' };
  render(input.subjectTemplate, sample, { html: false, strict: false });
  render(input.bodyTemplate, sample, { html: true, strict: false });

  if (input.aiEnabled) {
    if (!getPersonalizationProvider().enabled) {
      throw new HttpError(422, 'AI personalization requested but no AI provider is configured (set ANTHROPIC_API_KEY).');
    }
    if (!input.aiPrompt) {
      throw new HttpError(422, 'aiPrompt is required when aiEnabled is true (describe what the {{ai}} sentence should say).');
    }
    if (!input.subjectTemplate.includes('{{ai}}') && !input.bodyTemplate.includes('{{ai}}')) {
      throw new HttpError(422, 'AI is enabled but neither template uses the {{ai}} placeholder.');
    }
  }

  return prisma.campaign.create({
    data: {
      name: input.name,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      replyTo: input.replyTo ?? config.mail.replyTo,
      subjectTemplate: input.subjectTemplate,
      bodyTemplate: input.bodyTemplate,
      aiEnabled: input.aiEnabled,
      aiPrompt: input.aiPrompt ?? null,
      throttlePerHour: input.throttlePerHour,
    },
  });
}

/**
 * Enrol an audience into a DRAFT campaign. Only ACTIVE, consented leads that
 * are not suppressed are added. Returns counts so the operator sees exactly who
 * was excluded and why before anything is sent.
 */
export async function buildAudience(
  campaignId: string,
  filter: { leadIds?: string[]; consentBasis?: string[] },
) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  if (campaign.status !== 'DRAFT') throw new HttpError(409, 'Audience can only be built for a DRAFT campaign');

  const leads = await prisma.lead.findMany({
    where: {
      status: 'ACTIVE',
      ...(filter.leadIds ? { id: { in: filter.leadIds } } : {}),
      ...(filter.consentBasis ? { consentBasis: { in: filter.consentBasis as never[] } } : {}),
    },
  });

  if (leads.length > config.policy.campaignMaxRecipients) {
    throw new HttpError(
      422,
      `Audience of ${leads.length} exceeds CAMPAIGN_MAX_RECIPIENTS=${config.policy.campaignMaxRecipients}. ` +
        'Narrow the audience or raise the limit deliberately.',
    );
  }

  // Double-check against the suppression list (belt and braces — ingest already
  // filters, but statuses can change between ingest and send).
  const suppressed = await filterSuppressed(leads.map((l) => l.email));

  let enrolled = 0;
  let skippedSuppressed = 0;
  for (const lead of leads) {
    if (suppressed.has(lead.email)) {
      skippedSuppressed += 1;
      continue;
    }
    // Upsert so re-running is idempotent (unique on campaignId+leadId).
    await prisma.campaignRecipient.upsert({
      where: { campaignId_leadId: { campaignId, leadId: lead.id } },
      create: { campaignId, leadId: lead.id },
      update: {},
    });
    enrolled += 1;
  }

  return { matched: leads.length, enrolled, skippedSuppressed };
}

/** Pre-render every recipient's subject + body, surfacing template errors. */
export async function renderCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new HttpError(404, 'Campaign not found');

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: { in: ['PENDING', 'FAILED'] } },
    include: { lead: true },
  });

  const errors: { leadId: string; email: string; message: string }[] = [];
  let rendered = 0;
  let personalized = 0;

  const provider = getPersonalizationProvider();
  const useAi = campaign.aiEnabled && provider.enabled && !!campaign.aiPrompt;

  // Personalize + render each recipient, a few at a time. A per-recipient failure
  // (bad template or an LLM error) is reported and leaves that recipient PENDING
  // so it is never dispatched half-finished — re-run render to retry.
  await pMap(
    recipients,
    async (r) => {
      try {
        let aiSnippet = '';
        if (useAi) {
          aiSnippet = await provider.generate({
            instruction: campaign.aiPrompt!,
            campaignName: campaign.name,
            lead: {
              firstName: r.lead.firstName,
              lastName: r.lead.lastName,
              company: r.lead.company,
              title: r.lead.title,
              attributes: (r.lead.attributes as Record<string, unknown>) ?? {},
            },
          });
          if (aiSnippet) personalized += 1;
        }

        const ctx = {
          firstName: r.lead.firstName ?? '',
          lastName: r.lead.lastName ?? '',
          company: r.lead.company ?? '',
          title: r.lead.title ?? '',
          email: r.lead.email,
          attributes: (r.lead.attributes as Record<string, unknown>) ?? {},
          ai: aiSnippet,
        };

        const subject = render(campaign.subjectTemplate, ctx, { html: false, strict: true, optional: OPTIONAL_TOKENS });
        const html = render(campaign.bodyTemplate, ctx, { html: true, strict: true, optional: OPTIONAL_TOKENS });

        await prisma.campaignRecipient.update({
          where: { id: r.id },
          data: { renderedSubject: subject, renderedHtml: html, aiSnippet: aiSnippet || null, status: 'PENDING' },
        });
        rendered += 1;
      } catch (err) {
        errors.push({ leadId: r.leadId, email: r.lead.email, message: (err as Error).message });
      }
    },
    config.ai.concurrency,
  );

  return { rendered, personalized, errors };
}

export function unusedTokens(template: string): string[] {
  const allowed = new Set(['firstName', 'lastName', 'company', 'title', 'email', 'ai']);
  return extractTokens(template).filter((t) => !t.startsWith('attributes.') && !allowed.has(t));
}

export async function getCampaignStats(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  const grouped = await prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  return { campaign, byStatus };
}
