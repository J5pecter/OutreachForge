import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { prisma } from '../db';
import { createRedis } from './connection';
import { enqueueCampaign } from '../modules/sending/dispatcher';

export const SCHEDULER_QUEUE_NAME = 'dispatch-scheduler';
const JOB_SCHEDULER_ID = 'auto-dispatch-tick';

let queue: Queue | null = null;
function schedulerQueue(): Queue {
  if (!queue) queue = new Queue(SCHEDULER_QUEUE_NAME, { connection: createRedis() });
  return queue;
}

/**
 * Register the repeatable tick. Idempotent (upsert), and BullMQ produces exactly
 * one tick per interval regardless of how many scheduler processes call this, so
 * campaigns are never double-enqueued by redundant schedulers.
 */
export async function registerAutoDispatch(): Promise<void> {
  await schedulerQueue().upsertJobScheduler(
    JOB_SCHEDULER_ID,
    { every: config.scheduler.intervalSeconds * 1000 },
    { name: 'tick' },
  );
}

export async function closeSchedulerQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

/** Server-local quiet-hours check. Default window (0–24) is always open. */
export function isWithinSendWindow(date = new Date()): boolean {
  const { startHour, endHour } = config.sendWindow;
  const h = date.getHours();
  return h >= startHour && h < endHour;
}

/**
 * One scheduler tick: enqueue each active campaign's fair share for the interval.
 * `perTick = ceil(perHour × intervalSeconds / 3600)` — just enough to sustain the
 * campaign's rate until the next tick. The send worker's global limiter remains
 * the hard hourly ceiling; this only decides how much to hand it each tick.
 */
export async function runDispatchTick(): Promise<{
  campaigns: number;
  enqueued: number;
  skipped?: string;
}> {
  if (!isWithinSendWindow()) return { campaigns: 0, enqueued: 0, skipped: 'outside send window' };

  const active = await prisma.campaign.findMany({
    // Skip campaigns still awaiting mobile approval — they're released by tap.
    where: {
      status: { in: ['QUEUED', 'SENDING'] },
      OR: [{ approvalRequired: false }, { approvedAt: { not: null } }],
    },
    select: { id: true, throttlePerHour: true },
  });

  let enqueued = 0;
  for (const c of active) {
    const perHour = Math.min(c.throttlePerHour, config.policy.sendMaxPerHour);
    const perTick = Math.min(
      config.scheduler.batchCap,
      Math.max(1, Math.ceil((perHour * config.scheduler.intervalSeconds) / 3600)),
    );
    try {
      const res = await enqueueCampaign(c.id, perTick, { spread: false });
      enqueued += res.enqueued;
    } catch (err) {
      // A campaign that changed state mid-tick (e.g. paused) just gets skipped.
      // eslint-disable-next-line no-console
      console.warn(`[scheduler] campaign ${c.id} skipped: ${(err as Error).message}`);
    }
  }
  return { campaigns: active.length, enqueued };
}

export function createSchedulerWorker(): Worker {
  const worker = new Worker(SCHEDULER_QUEUE_NAME, async () => runDispatchTick(), {
    connection: createRedis(),
  });
  worker.on('completed', (_job, result) => {
    if (result && (result.enqueued > 0 || result.skipped)) {
      // eslint-disable-next-line no-console
      console.log(
        `[scheduler] tick — ${result.enqueued} enqueued across ${result.campaigns} campaign(s)` +
          (result.skipped ? ` (${result.skipped})` : ''),
      );
    }
  });
  return worker;
}
