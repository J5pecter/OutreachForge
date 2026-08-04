import { config } from '../../config';

/**
 * Build the compliance furniture every message must carry:
 *  - a visible unsubscribe link + physical-address footer (CAN-SPAM),
 *  - List-Unsubscribe and List-Unsubscribe-Post headers for one-click
 *    unsubscribe (RFC 8058), which mailbox providers reward.
 *
 * The unsubscribe URL is derived from the recipient's opaque token.
 */
export function unsubscribeUrl(token: string): string {
  return `${config.publicBaseUrl}/u/${token}`;
}

/** Append a self-hosted open-tracking pixel to an HTML body. */
export function withOpenPixel(html: string, token: string): string {
  const src = `${config.publicBaseUrl}/o/${token}.gif`;
  return `${html}\n<img src="${src}" width="1" height="1" alt="" style="display:none"/>`;
}

export function listUnsubscribeHeaders(token: string): Record<string, string> {
  const url = unsubscribeUrl(token);
  return {
    'List-Unsubscribe': `<${url}>, <mailto:${config.mail.replyTo}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Append the required visible footer to an HTML body. */
export function withHtmlFooter(html: string, token: string, senderAddress: string): string {
  const url = unsubscribeUrl(token);
  return (
    `${html}\n<hr/>\n` +
    `<p style="font-size:12px;color:#666">` +
    `You received this because ${escapeHtml(senderAddress)}. ` +
    `<a href="${url}">Unsubscribe</a> at any time.` +
    `</p>`
  );
}

/** Plain-text alternative — always shipped alongside HTML. */
export function withTextFooter(text: string, token: string, senderAddress: string): string {
  return `${text}\n\n---\nYou received this because ${senderAddress}.\nUnsubscribe: ${unsubscribeUrl(token)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Very small HTML-to-text so we can always provide a text/plain part without a
// heavy dependency. Not a full converter — good enough for templated bodies.
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
