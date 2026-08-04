import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySendgrid, verifySns, type SnsMessage } from './verify';

// ── SendGrid ECDSA round-trip ───────────────────────────────────────────
function ecKeyAndSpki() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { spkiBase64, privateKey };
}

function sign(privateKey: crypto.KeyObject, timestamp: string, body: Buffer) {
  const signer = crypto.createSign('sha256');
  signer.update(Buffer.concat([Buffer.from(timestamp, 'utf8'), body]));
  signer.end();
  return signer.sign(privateKey).toString('base64');
}

test('verifySendgrid accepts a correctly signed payload', () => {
  const { spkiBase64, privateKey } = ecKeyAndSpki();
  const body = Buffer.from(JSON.stringify([{ email: 'a@b.com', event: 'bounce' }]));
  const ts = '1700000000';
  assert.equal(verifySendgrid(spkiBase64, body, sign(privateKey, ts, body), ts), true);
});

test('verifySendgrid rejects a tampered body', () => {
  const { spkiBase64, privateKey } = ecKeyAndSpki();
  const ts = '1700000000';
  const sig = sign(privateKey, ts, Buffer.from('original'));
  assert.equal(verifySendgrid(spkiBase64, Buffer.from('tampered'), sig, ts), false);
});

test('verifySendgrid rejects a signature from a different key', () => {
  const a = ecKeyAndSpki();
  const b = ecKeyAndSpki();
  const body = Buffer.from('payload');
  const ts = '1700000000';
  assert.equal(verifySendgrid(a.spkiBase64, body, sign(b.privateKey, ts, body), ts), false);
});

// ── SNS host guard (no network hit) ─────────────────────────────────────
test('verifySns rejects an untrusted SigningCertURL host', async () => {
  const msg: SnsMessage = {
    Type: 'Notification',
    Message: 'x',
    MessageId: 'id',
    Timestamp: 't',
    TopicArn: 'arn',
    Signature: Buffer.from('sig').toString('base64'),
    SignatureVersion: '1',
    SigningCertURL: 'https://evil.example.com/cert.pem',
  };
  assert.equal(await verifySns(msg), false);
});

test('verifySns rejects a non-https cert URL', async () => {
  const msg: SnsMessage = {
    Type: 'Notification',
    Message: 'x',
    MessageId: 'id',
    Timestamp: 't',
    TopicArn: 'arn',
    Signature: Buffer.from('sig').toString('base64'),
    SignatureVersion: '1',
    SigningCertURL: 'http://sns.us-east-1.amazonaws.com/cert.pem',
  };
  assert.equal(await verifySns(msg), false);
});

test('verifySns rejects when the signature is missing', async () => {
  assert.equal(await verifySns({ Type: 'Notification' }), false);
});
