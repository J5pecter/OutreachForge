import { Router, text } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../../lib/http';
import { ingestSchema } from './leads.schema';
import { ingestLeads, listLeads, getLead } from './leads.service';
import { parseLeadsCsv } from './csv';

export const leadsRouter = Router();

// JSON ingest: { defaults?, leads: [...] }
leadsRouter.post(
  '/ingest',
  asyncHandler(async (req, res) => {
    const body = ingestSchema.parse(req.body);
    const result = await ingestLeads(body.leads, body.defaults);
    res.status(result.errors.length && result.created + result.updated === 0 ? 422 : 200).json(result);
  }),
);

// CSV ingest: raw text/csv body. Consent defaults come from query params so a
// spreadsheet without consent columns still can't be imported blind.
leadsRouter.post(
  '/ingest/csv',
  text({ type: ['text/csv', 'text/plain'], limit: '10mb' }),
  asyncHandler(async (req, res) => {
    if (typeof req.body !== 'string' || req.body.trim() === '') {
      throw new HttpError(400, 'Expected a non-empty text/csv body');
    }
    const defaults = z
      .object({
        consentBasis: z
          .enum(['OPT_IN', 'EXISTING_CUSTOMER', 'CONTRACT', 'LEGITIMATE_INTEREST', 'IMPORTED_WITH_CONSENT'])
          .optional(),
        consentSource: z.string().trim().min(1).optional(),
        consentAt: z.coerce.date().optional(),
        consentNote: z.string().trim().optional(),
      })
      .parse(req.query);
    const rows = parseLeadsCsv(req.body);
    const result = await ingestLeads(rows, defaults);
    res.json(result);
  }),
);

leadsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
        status: z.enum(['ACTIVE', 'UNSUBSCRIBED', 'BOUNCED', 'SUPPRESSED']).optional(),
      })
      .parse(req.query);
    res.json(await listLeads(q));
  }),
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getLead(req.params.id));
  }),
);
