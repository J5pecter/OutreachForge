import IORedis from 'ioredis';
import { config } from '../config';

// BullMQ requires `maxRetriesPerRequest: null` on the ioredis connection used by
// workers (blocking commands). We use the same setting everywhere for simplicity.
export function createRedis(): IORedis {
  return new IORedis(config.redis.url, { maxRetriesPerRequest: null });
}

export const SEND_QUEUE_NAME = 'send-email';
