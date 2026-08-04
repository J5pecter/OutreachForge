import crypto from 'node:crypto';

// ── SendGrid Event Webhook (ECDSA) ──────────────────────────────────────
// SendGrid signs `timestamp + rawBody` with ECDSA (P-256, SHA-256). The
// verification key from the SendGrid UI is base64 DER (SPKI). The signature
// header is a base64 DER-encoded ECDSA signature.
// Docs: https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features

function spkiToPem(base64Key: string): string {
  const body = base64Key.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? base64Key;
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

export function verifySendgrid(
  publicKeyBase64: string,
  rawBody: Buffer,
  signatureBase64: string,
  timestamp: string,
): boolean {
  try {
    const pem = spkiToPem(publicKeyBase64);
    const verifier = crypto.createVerify('sha256');
    verifier.update(Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]));
    verifier.end();
    return verifier.verify(pem, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

// ── AWS SNS message signature ───────────────────────────────────────────
// SNS signs a canonical string built from specific fields, using the RSA key in
// a certificate fetched from SigningCertURL. We only trust certs served over
// https from an sns.<region>.amazonaws.com host.
// Docs: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

export type SnsMessage = {
  Type?: string;
  Message?: string;
  MessageId?: string;
  Subject?: string;
  SubscribeURL?: string;
  Timestamp?: string;
  Token?: string;
  TopicArn?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
};

const SNS_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;
const certCache = new Map<string, string>();

async function fetchSigningCert(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !SNS_CERT_HOST.test(parsed.hostname)) {
    throw new Error(`Untrusted SigningCertURL host: ${parsed.hostname}`);
  }
  const cached = certCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Signing cert fetch failed (${res.status})`);
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
}

function canonicalString(msg: SnsMessage): string | null {
  const fields =
    msg.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  let out = '';
  for (const field of fields) {
    const value = (msg as Record<string, unknown>)[field];
    if (value === undefined || value === null) {
      if (field === 'Subject') continue; // Subject is optional and omitted when absent
      return null; // a required field is missing → cannot verify
    }
    out += `${field}\n${value}\n`;
  }
  return out;
}

export async function verifySns(msg: SnsMessage): Promise<boolean> {
  if (!msg.Signature || !msg.SigningCertURL) return false;
  try {
    const canonical = canonicalString(msg);
    if (!canonical) return false;
    const cert = await fetchSigningCert(msg.SigningCertURL);
    const publicKey = new crypto.X509Certificate(cert).publicKey;
    const algorithm = msg.SignatureVersion === '2' ? 'sha256' : 'sha1';
    const verifier = crypto.createVerify(algorithm);
    verifier.update(canonical, 'utf8');
    verifier.end();
    return verifier.verify(publicKey, Buffer.from(msg.Signature, 'base64'));
  } catch {
    return false;
  }
}
