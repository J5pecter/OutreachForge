// Centralised, validated configuration. Fail fast on obviously-wrong values.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

function str(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export type MailProvider = 'dryrun' | 'smtp';

const provider = str('MAIL_PROVIDER', 'dryrun') as MailProvider;
if (provider !== 'dryrun' && provider !== 'smtp') {
  throw new Error(`MAIL_PROVIDER must be "dryrun" or "smtp", got "${provider}"`);
}

export const config = {
  port: num('PORT', 4000),
  publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:4000').replace(/\/+$/, ''),

  mail: {
    provider,
    fromName: str('MAIL_FROM_NAME', 'Your Company'),
    fromEmail: str('MAIL_FROM_EMAIL', 'hello@example.com'),
    replyTo: str('MAIL_REPLY_TO', str('MAIL_FROM_EMAIL', 'hello@example.com')),
    smtp: {
      host: str('SMTP_HOST'),
      port: num('SMTP_PORT', 587),
      user: str('SMTP_USER'),
      pass: str('SMTP_PASS'),
      secure: str('SMTP_SECURE', 'false') === 'true',
    },
  },

  redis: {
    url: str('REDIS_URL', 'redis://localhost:6379'),
  },

  // Personalization provider auto-selected from whichever key is set:
  // Gemini (free tier) → Anthropic → none (template-only, {{ai}} renders empty).
  // AI_MODEL overrides the per-provider default model.
  ai: {
    provider: (str('GEMINI_API_KEY') ? 'gemini' : str('ANTHROPIC_API_KEY') ? 'anthropic' : 'none') as
      | 'gemini'
      | 'anthropic'
      | 'none',
    geminiKey: str('GEMINI_API_KEY'),
    anthropicKey: str('ANTHROPIC_API_KEY'),
    model: str('AI_MODEL'), // empty → provider default
    maxTokens: num('AI_MAX_TOKENS', 160),
    concurrency: num('AI_CONCURRENCY', 5),
    timeoutMs: num('AI_TIMEOUT_MS', 20_000),
  },

  policy: {
    sendMaxPerHour: num('SEND_MAX_PER_HOUR', 200),
    campaignMaxRecipients: num('CAMPAIGN_MAX_RECIPIENTS', 5000),
    workerConcurrency: num('SEND_WORKER_CONCURRENCY', 5),
  },

  scheduler: {
    // How often the auto-dispatch scheduler ticks. Each tick enqueues each
    // active campaign's fair share for the interval (rate × interval), so
    // per-campaign pacing comes from the tick cadence, not per-job delays.
    intervalSeconds: num('AUTO_DISPATCH_INTERVAL_SECONDS', 60),
    // Hard cap on how many a single campaign can enqueue in one tick.
    batchCap: num('AUTO_DISPATCH_MAX_PER_TICK', 500),
  },

  // Optional quiet hours (server local time, 24h). Defaults to always-open
  // (0–24). The scheduler will not enqueue new batches outside this window;
  // already-queued jobs still send.
  sendWindow: {
    startHour: num('SEND_WINDOW_START_HOUR', 0),
    endHour: num('SEND_WINDOW_END_HOUR', 24),
  },

  // Where the "approve on your phone" link is delivered. Telegram is the best
  // mobile push (free, instant); email is a fallback. If neither is set, the
  // link is just returned from the API + logged.
  approval: {
    telegramBotToken: str('TELEGRAM_BOT_TOKEN'),
    telegramChatId: str('TELEGRAM_CHAT_ID'),
    email: str('APPROVAL_EMAIL'),
  },

  webhooks: {
    // Optional shared secret. When set, inbound ESP webhooks must present it as
    // ?token=... — an extra layer on top of signature verification below.
    token: str('WEBHOOK_TOKEN'),
    // Auto-confirm AWS SNS subscription handshakes for SES event notifications.
    sesAutoConfirm: str('SES_SNS_AUTO_CONFIRM', 'false') === 'true',
    // SendGrid Event Webhook verification key (base64, from the SendGrid UI).
    // When set, SendGrid requests without a valid ECDSA signature are rejected.
    sendgridPublicKey: str('SENDGRID_WEBHOOK_PUBLIC_KEY'),
    // Verify the RSA signature on inbound SNS messages against the AWS signing
    // cert. On by default; set false only for local testing with faked payloads.
    snsVerify: str('SNS_VERIFY_SIGNATURE', 'true') === 'true',
  },
} as const;
