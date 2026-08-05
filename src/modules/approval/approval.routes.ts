import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { approveByToken } from './approval.service';

// Public, mobile-friendly approval pages. GET shows a confirm page (so a link
// preview/prefetch can't auto-approve); the button POSTs to actually approve.
export const approvalRouter = Router();

function page(body: string): string {
  return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
  <div style="font-family:system-ui;max-width:28rem;margin:15vh auto;padding:0 1.25rem;text-align:center">${body}</div>`;
}

approvalRouter.get(
  '/approve/:token',
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    res
      .type('html')
      .send(
        page(
          `<h1 style="font-size:1.4rem">Approve this send?</h1>
           <p style="color:#475569">Tapping approve releases the campaign to the send queue.</p>
           <form method="post" action="/approve/${token}">
             <button type="submit" style="background:#4f46e5;color:#fff;border:0;border-radius:.6rem;padding:.8rem 1.4rem;font-size:1rem;font-weight:600">
               Approve &amp; send
             </button>
           </form>`,
        ),
      );
  }),
);

approvalRouter.post(
  '/approve/:token',
  asyncHandler(async (req, res) => {
    const result = await approveByToken(req.params.token);
    res
      .type('html')
      .send(
        page(
          `<h1 style="font-size:1.4rem;color:#059669">Approved ✓</h1>
           <p style="color:#475569">"${result.name}" is sending now — ${result.enqueued} recipient(s) queued.</p>`,
        ),
      );
  }),
);
