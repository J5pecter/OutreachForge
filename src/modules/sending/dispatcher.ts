import { prisma } from '../../db';
import { config } from '../../config';
import { HttpError } from '../../lib/http';
import { sendQueue } from '../../queue/sendQueue';

/**
 * Enqueue a bounded batch of a campaign's rendered recipients onto the send
 * queue. This returns immediately — the actual sending happens in the worker
 * process(es). Two independent controls shape delivery:
 *
 *   1. Per-campaign pacing: with `spread` (the default, for one-shot manual
 *      dispatch) jobs are spaced by `intervalMs = 3.6e6 / perHour` as per-job
 *      delays. The scheduler passes `spread: false` and instead enqueues only a
 *      tick's worth each time, so pacing comes from the tick cadence and delays
 *      don't reset on every batch.
 *   2. Global ceiling: the worker's Redis-backed limiter caps total sends per
 *      hour across every worker (see sendWorker.ts).
 */
export async function enqueueCampaign(
  campaignId: string,
  max: number,
  opts: { spread?: boolean } = {},
) {
  const spread = opts.spread ?? true;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  if (!['QUEUED', 'SENDING'].includes(campaign.status)) {
    throw new HttpError(409, `Campaign is ${campaign.status}; queue it before dispatching`);
  }

  const perHour = Math.min(campaign.throttlePerHour, config.policy.sendMaxPerHour);
  const intervalMs = spread ? Math.ceil(3_600_000 / perHour) : 0;

  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'PENDING', renderedHtml: { not: null } },
    select: { id: true },
    take: max,
    orderBy: { id: 'asc' },
  });

  if (pending.length === 0) {
    return { enqueued: 0, perHour, intervalMs, note: 'No rendered PENDING recipients to enqueue.' };
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'SENDING' } });

  // Mark them QUEUED up front so a second dispatch call can't double-enqueue,
  // and so completion detection (count of QUEUED) is accurate.
  const ids = pending.map((p) => p.id);
  await prisma.campaignRecipient.updateMany({
    where: { id: { in: ids } },
    data: { status: 'QUEUED', queuedAt: new Date() },
  });

  const queue = sendQueue();
  await queue.addBulk(
    ids.map((recipientId, i) => ({
      name: 'send',
      data: { recipientId },
      opts: { delay: intervalMs ? i * intervalMs : 0, jobId: recipientId },
    })),
  );

  return { enqueued: ids.length, perHour, intervalMs };
}
