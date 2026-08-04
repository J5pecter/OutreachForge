// Auto-dispatch scheduler process. Running this process is what turns on
// automatic sending: it periodically enqueues batches for every QUEUED/SENDING
// campaign, so operators only need to queue a campaign — no manual /dispatch.
//
//   npm run scheduler:dev   (development)
//   npm run scheduler       (compiled)
import { config } from './config';
import { prisma } from './db';
import { registerAutoDispatch, createSchedulerWorker, closeSchedulerQueue } from './queue/scheduler';

async function main() {
  await registerAutoDispatch();
  const worker = createSchedulerWorker();

  const { startHour, endHour } = config.sendWindow;
  const windowNote =
    startHour === 0 && endHour === 24 ? 'always open' : `${startHour}:00–${endHour}:00 (server local)`;
  // eslint-disable-next-line no-console
  console.log(
    `auto-dispatch scheduler up — tick every ${config.scheduler.intervalSeconds}s, ` +
      `send window ${windowNote}`,
  );

  async function shutdown(signal: string) {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received — stopping scheduler…`);
    await worker.close();
    await closeSchedulerQueue();
    await prisma.$disconnect();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
