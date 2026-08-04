// Standalone send-worker process. Run one or many alongside the API:
//   npm run worker:dev   (development)
//   npm run worker       (compiled)
import { config } from './config';
import { createSendWorker } from './queue/sendWorker';
import { prisma } from './db';

const worker = createSendWorker();

// eslint-disable-next-line no-console
console.log(
  `send-worker up — concurrency ${config.policy.workerConcurrency}, ` +
    `global ceiling ${config.policy.sendMaxPerHour}/h, provider ${config.mail.provider}` +
    (config.mail.provider === 'dryrun' ? ' (no mail will be sent)' : ''),
);

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received — draining worker…`);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
