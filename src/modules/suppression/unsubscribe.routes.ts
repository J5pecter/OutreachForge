import { Router } from 'express';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { suppress } from './suppression.service';

export const unsubscribeRouter = Router();

async function handleUnsubscribe(token: string): Promise<boolean> {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { token },
    include: { lead: true },
  });
  if (!recipient) return false;
  await suppress(recipient.lead.email, 'UNSUBSCRIBE', `campaign ${recipient.campaignId}`);
  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { status: 'UNSUBSCRIBED', events: { create: { type: 'unsubscribe' } } },
  });
  return true;
}

// RFC 8058 one-click unsubscribe target (List-Unsubscribe-Post). Mail clients
// POST here directly — no landing page, no confirmation step.
unsubscribeRouter.post(
  '/u/:token',
  asyncHandler(async (req, res) => {
    await handleUnsubscribe(req.params.token);
    res.status(200).send('Unsubscribed');
  }),
);

// Human-facing GET link (the visible "unsubscribe" in the footer).
unsubscribeRouter.get(
  '/u/:token',
  asyncHandler(async (req, res) => {
    const ok = await handleUnsubscribe(req.params.token);
    res
      .status(ok ? 200 : 404)
      .type('html')
      .send(
        ok
          ? '<h1>You are unsubscribed</h1><p>You will not receive further emails from us. Sorry for the intrusion.</p>'
          : '<h1>Link not recognised</h1><p>This unsubscribe link is invalid or expired.</p>',
      );
  }),
);
