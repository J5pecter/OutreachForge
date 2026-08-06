import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { config } from './config';
import { HttpError } from './lib/http';
import { cors } from './lib/cors';
import { createSendWorker } from './queue/sendWorker';
import { registerAutoDispatch, createSchedulerWorker } from './queue/scheduler';
import { leadsRouter } from './modules/leads/leads.routes';
import { campaignsRouter } from './modules/campaigns/campaigns.routes';
import { suppressionRouter } from './modules/suppression/suppression.routes';
import { unsubscribeRouter } from './modules/suppression/unsubscribe.routes';
import { webhooksRouter } from './modules/webhooks/webhooks.routes';
import { trackingRouter } from './modules/webhooks/tracking.routes';
import { approvalRouter } from './modules/approval/approval.routes';

const app = express();

if (config.corsOrigin) app.use(cors(config.corsOrigin));

// Webhooks must see the RAW request body for signature verification, so they
// are mounted BEFORE express.json() (which would otherwise consume the stream).
app.use('/api/webhooks', webhooksRouter);

app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, provider: config.mail.provider });
});

app.use('/api/leads', leadsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/suppression', suppressionRouter);

// Public endpoints live at the root so links stay short.
app.use('/', unsubscribeRouter);
app.use('/', trackingRouter);
app.use('/', approvalRouter);

// Central error handler.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'validation_error', issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: 'internal_error' });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `OutreachForge API on :${config.port} — mail provider: ${config.mail.provider}` +
      (config.mail.provider === 'dryrun' ? ' (no mail will be sent)' : ''),
  );
});

// Single-service deploys (e.g. Render free tier) run the worker + scheduler in
// this same process instead of as separate services.
if (config.runWorkerInProcess) {
  createSendWorker();
  void registerAutoDispatch().then(() => createSchedulerWorker());
  // eslint-disable-next-line no-console
  console.log('in-process send worker + auto-dispatch scheduler started');
}
