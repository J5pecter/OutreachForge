import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config';

export type OutgoingMessage = {
  to: string;
  from: string; // "Name <email>"
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type SendResult = { messageId: string; accepted: boolean };

export interface MailProvider {
  send(msg: OutgoingMessage): Promise<SendResult>;
}

/**
 * Renders and logs the message but sends nothing. This is the DEFAULT so that a
 * fresh install cannot email anyone before the operator has explicitly
 * configured an authenticated relay and confirmed their list is consented.
 */
class DryRunProvider implements MailProvider {
  private counter = 0;
  async send(msg: OutgoingMessage): Promise<SendResult> {
    this.counter += 1;
    const messageId = `dryrun-${Date.now()}-${this.counter}@localhost`;
    // eslint-disable-next-line no-console
    console.log(
      `[dryrun] would send to=${msg.to} subject=${JSON.stringify(msg.subject)} ` +
        `list-unsubscribe=${msg.headers?.['List-Unsubscribe'] ?? 'none'}`,
    );
    return { messageId, accepted: true };
  }
}

class SmtpProvider implements MailProvider {
  private transporter: Transporter;
  constructor() {
    const { smtp } = config.mail;
    if (!smtp.host) throw new Error('MAIL_PROVIDER=smtp but SMTP_HOST is empty');
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }
  async send(msg: OutgoingMessage): Promise<SendResult> {
    const info = await this.transporter.sendMail({
      to: msg.to,
      from: msg.from,
      replyTo: msg.replyTo,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: msg.headers,
    });
    const accepted = Array.isArray(info.accepted) && info.accepted.length > 0;
    return { messageId: info.messageId, accepted };
  }
}

let instance: MailProvider | null = null;

export function getMailProvider(): MailProvider {
  if (instance) return instance;
  instance = config.mail.provider === 'smtp' ? new SmtpProvider() : new DryRunProvider();
  return instance;
}
