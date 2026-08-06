import type { Request, Response, NextFunction } from 'express';

/**
 * Minimal CORS for the hosted split (dashboard on one origin, API on another).
 * `originsCsv` is a comma-separated allowlist, or '*'. Empty → no-op
 * (same-origin only). Reflects the request Origin when allowed and answers
 * preflight OPTIONS.
 */
export function cors(originsCsv: string) {
  const list = originsCsv.split(',').map((s) => s.trim()).filter(Boolean);
  const allowAll = list.includes('*');

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('origin');
    if (origin && (allowAll || list.includes(origin))) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}
