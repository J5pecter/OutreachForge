import type { EspEvent } from './webhooks.service';

// SendGrid Event Webhook posts an array of events. Docs:
// https://docs.sendgrid.com/for-developers/tracking-events/event
type SgEvent = {
  email?: string;
  event?: string;
  type?: string; // for bounce: "bounce" (hard) vs "blocked" (soft)
  sg_message_id?: string;
  reason?: string;
};

export function parseSendgrid(body: unknown): EspEvent[] {
  if (!Array.isArray(body)) return [];
  const out: EspEvent[] = [];
  for (const raw of body as SgEvent[]) {
    const email = raw.email;
    if (!email) continue;
    const messageId = raw.sg_message_id?.split('.')[0]; // SG appends internal suffix
    const meta = { reason: raw.reason };
    switch (raw.event) {
      case 'delivered':
        out.push({ kind: 'delivered', email, messageId, meta });
        break;
      case 'open':
        out.push({ kind: 'open', email, messageId, meta });
        break;
      case 'click':
        out.push({ kind: 'click', email, messageId, meta });
        break;
      case 'bounce':
        // SG "bounce" == hard, "blocked" == soft/transient.
        out.push({ kind: 'bounce', email, messageId, hard: raw.type !== 'blocked', meta });
        break;
      case 'dropped':
        out.push({ kind: 'bounce', email, messageId, hard: true, meta });
        break;
      case 'spamreport':
        out.push({ kind: 'complaint', email, messageId, meta });
        break;
      case 'unsubscribe':
      case 'group_unsubscribe':
        out.push({ kind: 'unsubscribe', email, messageId, meta });
        break;
      default:
        break; // processed / deferred / etc. — ignored
    }
  }
  return out;
}
