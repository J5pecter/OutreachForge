import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../../config';
import { asyncHandler, HttpError } from '../../lib/http';
import { applyEspEvents } from './webhooks.service';
import { parseSendgrid } from './sendgrid';
import { parseSes } from './ses';
import { verifySendgrid, verifySns, type SnsMessage } from './verify';

export const webhooksRouter = Router();

// These routes need the RAW request body: SendGrid's signature covers the exact
// bytes. So this router parses to a Buffer and is mounted BEFORE the global JSON
// middleware (see index.ts). Each handler JSON-parses the buffer itself.
webhooksRouter.use(express.raw({ type: '*/*', limit: '5mb' }));

function rawBuffer(req: Request): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

function parseJson(req: Request): unknown {
  const buf = rawBuffer(req);
  return buf.length ? JSON.parse(buf.toString('utf8')) : null;
}

// Optional shared-secret guard (defense in depth alongside signature checks).
function requireToken(req: Request, _res: Response, next: NextFunction) {
  if (!config.webhooks.token) return next();
  if (req.query.token === config.webhooks.token) return next();
  next(new HttpError(401, 'Invalid or missing webhook token'));
}

webhooksRouter.post(
  '/sendgrid',
  requireToken,
  asyncHandler(async (req, res) => {
    const raw = rawBuffer(req);

    if (config.webhooks.sendgridPublicKey) {
      const signature = req.header('X-Twilio-Email-Event-Webhook-Signature');
      const timestamp = req.header('X-Twilio-Email-Event-Webhook-Timestamp');
      if (
        !signature ||
        !timestamp ||
        !verifySendgrid(config.webhooks.sendgridPublicKey, raw, signature, timestamp)
      ) {
        throw new HttpError(401, 'Invalid SendGrid webhook signature');
      }
    }

    const payload = parseJson(req);
    const events = parseSendgrid(payload);
    const result = await applyEspEvents(events);
    res.json({ received: Array.isArray(payload) ? payload.length : 0, ...result });
  }),
);

webhooksRouter.post(
  '/ses',
  requireToken,
  asyncHandler(async (req, res) => {
    const message = parseJson(req) as SnsMessage | null;
    if (!message) throw new HttpError(400, 'Empty SNS message');

    if (config.webhooks.snsVerify && !(await verifySns(message))) {
      throw new HttpError(401, 'Invalid SNS message signature');
    }

    const { events, subscribeUrl } = parseSes(message);

    // SNS subscription handshake: confirm by fetching SubscribeURL (opt-in).
    if (subscribeUrl) {
      if (config.webhooks.sesAutoConfirm) {
        await fetch(subscribeUrl).catch(() => undefined);
        return res.json({ confirmed: true });
      }
      // eslint-disable-next-line no-console
      console.log(`[ses] SNS SubscriptionConfirmation received. Confirm this URL:\n${subscribeUrl}`);
      return res.json({ confirmed: false, action: 'Open the logged SubscribeURL, or set SES_SNS_AUTO_CONFIRM=true' });
    }

    const result = await applyEspEvents(events);
    res.json(result);
  }),
);
