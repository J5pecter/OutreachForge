import { Worker, type Job } from 'bullmq';
import { config } from '../config';
import { createRedis, SEND_QUEUE_NAME } from './connection';
import type { SendJob } from './sendQueue';
import { maybeCompleteCampaign, markRecipientFailed, sendOneRecipient } from '../modules/sending/sendRecipient';

/**
 * The send worker. Multiple instances can run across processes/machines: the
 * BullMQ limiter below is enforced in Redis, so `SEND_MAX_PER_HOUR` is a global
 * ceiling no matter how many workers you start. Per-campaign pacing is handled
 * separately by the per-job delays set at enqueue time.
 */
export function createSendWorker(): Worker<SendJob> {
  const worker = new Worker<SendJob>(
    SEND_QUEUE_NAME,
    async (job: Job<SendJob>) => {
      const { recipientId } = job.data;
      try {
        const outcome = await sendOneRecipient(recipientId);
        await maybeCompleteCampaign(outcome.campaignId);
        return outcome;
      } catch (err) {
        const attempts = job.opts.attempts ?? 1;
        const isFinal = job.attemptsMade + 1 >= attempts;
        if (isFinal) {
          const campaignId = await markRecipientFailed(recipientId, (err as Error).message);
          if (campaignId) await maybeCompleteCampaign(campaignId);
          return { status: 'FAILED' as const };
        }
        throw err; // let BullMQ retry with backoff
      }
    },
    {
      connection: createRedis(),
      concurrency: config.policy.workerConcurrency,
      // Global across all workers on this queue: at most N sends per hour.
      limiter: { max: config.policy.sendMaxPerHour, duration: 3_600_000 },
    },
  );

  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[send-worker] job ${job?.id} failed: ${err.message}`);
  });
  // Swallow connection-level errors (an unhandled 'error' event would throw).
  worker.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[send-worker] error:', err.message);
  });

  return worker;
}
