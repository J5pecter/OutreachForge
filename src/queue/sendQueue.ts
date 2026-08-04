import { Queue } from 'bullmq';
import { createRedis, SEND_QUEUE_NAME } from './connection';

export type SendJob = { recipientId: string };

// Lazily created so importing this module (e.g. from the API) does not open a
// Redis connection until something actually enqueues.
let queue: Queue<SendJob> | null = null;

export function sendQueue(): Queue<SendJob> {
  if (!queue) {
    queue = new Queue<SendJob>(SEND_QUEUE_NAME, {
      connection: createRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 86_400, count: 10_000 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return queue;
}

export async function closeSendQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
