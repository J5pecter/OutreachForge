import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, Field, inputClass } from '../ui';

export function QuickSendPanel() {
  const [emailsText, setEmailsText] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [consented, setConsented] = useState(false);

  const emails = useMemo(
    () => emailsText.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean),
    [emailsText],
  );

  const send = useMutation({
    mutationFn: () => api.quickSend({ emails, subject, body, consented }),
  });

  const canSend = emails.length > 0 && subject.trim() && body.trim() && consented && !send.isPending;

  return (
    <div className="mx-auto max-w-2xl">
      <Card title="Send an email to your list">
        <div className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Each person gets their own separate email — never a shared To/CC. Unsubscribes and
            bounces are handled automatically. Send only to people who agreed to hear from you.
          </p>

          <Field label={`Emails (${emails.length})`} hint="One per line, or separated by commas/spaces.">
            <textarea
              className={`${inputClass} h-36 font-mono text-xs`}
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              placeholder={'dana@example.com\nsam@example.com'}
            />
          </Field>

          <Field label="Subject">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>

          <Field label="Message" hint="Plain text. Line breaks are kept. {{email}} inserts the recipient's address.">
            <textarea
              className={`${inputClass} h-44`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'Hi,\n\nWanted to share a quick update...'}
            />
          </Field>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
            />
            <span>These recipients agreed to hear from me (customers, subscribers, or contacts who gave me their email).</span>
          </label>

          <Button onClick={() => send.mutate()} disabled={!canSend}>
            {send.isPending ? 'Sending…' : `Send to ${emails.length} recipient${emails.length === 1 ? '' : 's'}`}
          </Button>

          {send.isError && <p className="text-sm text-rose-600">{(send.error as Error).message}</p>}

          {send.data && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <strong>{send.data.queued}</strong> queued and sending
              {send.data.perHour ? ` (~${send.data.perHour}/hr)` : ''}.
              {send.data.skippedSuppressed > 0 && (
                <> {send.data.skippedSuppressed} skipped (unsubscribed/bounced).</>
              )}
              {send.data.invalid.length > 0 && <> {send.data.invalid.length} invalid address(es) ignored.</>}
              {send.data.note && <> {send.data.note}</>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
