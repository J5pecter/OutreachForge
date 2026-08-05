import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../../lib/http';
import { prisma } from '../../db';
import { createCampaignSchema, buildAudienceSchema } from './campaigns.schema';
import {
  createCampaign,
  buildAudience,
  renderCampaign,
  getCampaignStats,
} from './campaigns.service';
import { enqueueCampaign } from '../sending/dispatcher';
import { requestApproval } from '../approval/approval.service';

export const campaignsRouter = Router();

campaignsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createCampaignSchema.parse(req.body);
    res.status(201).json(await createCampaign(input));
  }),
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getCampaignStats(req.params.id));
  }),
);

// Enrol consented, non-suppressed leads.
campaignsRouter.post(
  '/:id/audience',
  asyncHandler(async (req, res) => {
    const filter = buildAudienceSchema.parse(req.body ?? {});
    res.json(await buildAudience(req.params.id, filter));
  }),
);

// Pre-render all enrolled recipients; returns per-recipient template errors.
campaignsRouter.post(
  '/:id/render',
  asyncHandler(async (req, res) => {
    res.json(await renderCampaign(req.params.id));
  }),
);

// Move DRAFT -> QUEUED (an explicit human gate before anything can be sent).
campaignsRouter.post(
  '/:id/queue',
  asyncHandler(async (req, res) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    const ready = await prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, status: 'PENDING', preparedAt: { not: null } },
    });
    if (ready === 0) throw new HttpError(422, 'No prepared recipients. Build audience and render first.');
    const updated = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'QUEUED' } });
    res.json({ status: updated.status, readyToSend: ready });
  }),
);

// Enqueue a bounded batch onto the send queue. Returns immediately; the worker
// process performs the sends, paced per-campaign and capped globally. Call
// repeatedly (or from a scheduler) to enqueue further batches. `max` caps this
// single invocation.
campaignsRouter.post(
  '/:id/dispatch',
  asyncHandler(async (req, res) => {
    const { max } = z.object({ max: z.coerce.number().int().min(1).max(5000).default(500) }).parse(req.body ?? {});
    res.json(await enqueueCampaign(req.params.id, max));
  }),
);

// Require mobile approval and send the approve link (Telegram/email/log).
campaignsRouter.post(
  '/:id/request-approval',
  asyncHandler(async (req, res) => {
    res.json(await requestApproval(req.params.id));
  }),
);

campaignsRouter.post(
  '/:id/pause',
  asyncHandler(async (req, res) => {
    const updated = await prisma.campaign.update({ where: { id: req.params.id }, data: { status: 'PAUSED' } });
    res.json({ status: updated.status });
  }),
);
