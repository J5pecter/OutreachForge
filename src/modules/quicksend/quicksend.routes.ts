import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http';
import { quickSend } from './quicksend.service';

export const quickSendRouter = Router();

const schema = z.object({
  emails: z.array(z.string()).max(10000),
  subject: z.string(),
  body: z.string(),
  consented: z.boolean(),
});

quickSendRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = schema.parse(req.body);
    res.json(await quickSend(input));
  }),
);
