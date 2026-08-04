import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { suppress } from './suppression.service';

export const suppressionRouter = Router();

// Manually suppress an address (e.g. a direct complaint or a do-not-contact request).
suppressionRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { email, reason, note } = z
      .object({
        email: z.string().email(),
        reason: z.enum(['UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT', 'MANUAL']).default('MANUAL'),
        note: z.string().optional(),
      })
      .parse(req.body);
    await suppress(email, reason, note);
    res.status(201).json({ email: email.toLowerCase(), reason });
  }),
);

suppressionRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    res.json(await prisma.suppression.findMany({ take: limit, orderBy: { createdAt: 'desc' } }));
  }),
);
