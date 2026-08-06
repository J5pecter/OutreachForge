import IORedis from 'ioredis';
import { config } from '../config';

// BullMQ requires `maxRetriesPerRequest: null` on the ioredis connection used by
// workers (blocking commands). We use the same setting everywhere for simplicity.
export function createRedis(): IORedis {
  const conn = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
  // An ioredis 'error' event with no listener throws (crashing the process).
  // Attach one so connection blips (e.g. Upstash) are logged, not fatal.
  conn.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[redis] connection error:', err.message);
  });
  return conn;
}

export const SEND_QUEUE_NAME = 'send-email';
