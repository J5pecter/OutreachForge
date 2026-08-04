import type { EspEvent } from './webhooks.service';

// Amazon SES delivers bounce/complaint/delivery notifications via SNS. The SNS
// envelope wraps a JSON `Message` string. Docs:
// https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html
type SnsEnvelope = {
  Type?: string;
  SubscribeURL?: string;
  Message?: string;
};

type SesNotification = {
  notificationType?: string; // Bounce | Complaint | Delivery
  eventType?: string; // when using SES event publishing: Bounce | Complaint | Delivery | Open | Click
  mail?: { messageId?: string; destination?: string[] };
  bounce?: { bounceType?: string; bouncedRecipients?: { emailAddress: string }[] };
  complaint?: { complainedRecipients?: { emailAddress: string }[] };
};

export type SesParseResult = {
  events: EspEvent[];
  subscribeUrl?: string; // present on SubscriptionConfirmation
};

export function parseSes(body: unknown): SesParseResult {
  const env = (body ?? {}) as SnsEnvelope;

  if (env.Type === 'SubscriptionConfirmation') {
    return { events: [], subscribeUrl: env.SubscribeURL };
  }
  if (!env.Message) return { events: [] };

  let msg: SesNotification;
  try {
    msg = JSON.parse(env.Message);
  } catch {
    return { events: [] };
  }

  const type = msg.notificationType ?? msg.eventType;
  const messageId = msg.mail?.messageId;
  const events: EspEvent[] = [];

  if (type === 'Bounce') {
    const hard = msg.bounce?.bounceType === 'Permanent';
    for (const r of msg.bounce?.bouncedRecipients ?? []) {
      events.push({ kind: 'bounce', email: r.emailAddress, messageId, hard, meta: { bounceType: msg.bounce?.bounceType } });
    }
  } else if (type === 'Complaint') {
    for (const r of msg.complaint?.complainedRecipients ?? []) {
      events.push({ kind: 'complaint', email: r.emailAddress, messageId });
    }
  } else if (type === 'Delivery') {
    for (const email of msg.mail?.destination ?? []) {
      events.push({ kind: 'delivered', email, messageId });
    }
  } else if (type === 'Open') {
    for (const email of msg.mail?.destination ?? []) events.push({ kind: 'open', email, messageId });
  } else if (type === 'Click') {
    for (const email of msg.mail?.destination ?? []) events.push({ kind: 'click', email, messageId });
  }

  return { events };
}
