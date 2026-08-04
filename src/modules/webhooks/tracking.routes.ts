import { Router } from 'express';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';

export const trackingRouter = Router();

// 1x1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Optional self-hosted open pixel. Opens are also captured via ESP webhooks; use
// whichever your setup supports. Note: open tracking is a privacy consideration —
// disclose it in your privacy policy and consider offering plain-text sends.
trackingRouter.get(
  '/o/:token.gif',
  asyncHandler(async (req, res) => {
    const recipient = await prisma.campaignRecipient.findUnique({ where: { token: req.params.token } });
    if (recipient && !recipient.openedAt) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          openedAt: new Date(),
          status: recipient.status === 'SENT' ? 'OPENED' : recipient.status,
          events: { create: { type: 'open', meta: { source: 'pixel' } } },
        },
      });
    }
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.send(PIXEL);
  }),
);
