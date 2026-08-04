import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ConsentBasis } from '../api';
import { Badge, Button, Card, Field, inputClass } from '../ui';

const CONSENT_OPTIONS: ConsentBasis[] = [
  'OPT_IN',
  'EXISTING_CUSTOMER',
  'CONTRACT',
  'LEGITIMATE_INTEREST',
  'IMPORTED_WITH_CONSENT',
];

const SAMPLE_CSV = `email,firstName,company,title,industry
dana@example.com,Dana,Northwind,Head of Ops,Logistics
sam@example.com,Sam,Acme,CTO,SaaS`;

export function LeadsPanel() {
  const qc = useQueryClient();
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [consentBasis, setConsentBasis] = useState<ConsentBasis>('OPT_IN');
  const [consentSource, setConsentSource] = useState('');

  const leads = useQuery({ queryKey: ['leads'], queryFn: () => api.listLeads() });

  const ingest = useMutation({
    mutationFn: () => api.ingestCsv(csv, { consentBasis, consentSource }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Import leads (CSV)">
        <div className="space-y-4">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Every import records a lawful basis for contact. Leads that are missing consent, are
            duplicates, or are on the suppression list are handled automatically.
          </p>
          <Field label="Consent basis" hint="Why you are permitted to contact these people.">
            <select
              className={inputClass}
              value={consentBasis}
              onChange={(e) => setConsentBasis(e.target.value as ConsentBasis)}
            >
              {CONSENT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Consent source" hint="e.g. 'Webinar signup — Aug 2026' or a contract id.">
            <input
              className={inputClass}
              value={consentSource}
              onChange={(e) => setConsentSource(e.target.value)}
              placeholder="Where consent came from"
            />
          </Field>
          <Field label="CSV" hint="Header row required. Unknown columns become merge fields.">
            <textarea
              className={`${inputClass} h-40 font-mono text-xs`}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </Field>
          <Button onClick={() => ingest.mutate()} disabled={ingest.isPending || !consentSource.trim()}>
            {ingest.isPending ? 'Importing…' : 'Import'}
          </Button>
          {!consentSource.trim() && (
            <span className="ml-2 text-xs text-slate-400">Consent source is required.</span>
          )}
          {ingest.isError && <p className="text-xs text-rose-600">{(ingest.error as Error).message}</p>}
          {ingest.data && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              <strong>{ingest.data.created}</strong> created · <strong>{ingest.data.updated}</strong>{' '}
              updated · <strong>{ingest.data.skippedSuppressed}</strong> skipped (suppressed) ·{' '}
              <strong>{ingest.data.errors.length}</strong> errors
              {ingest.data.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-rose-600">
                  {ingest.data.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>
                      {e.email ?? `row ${e.index}`}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card
        title={`Leads${leads.data ? ` (${leads.data.leads.length})` : ''}`}
        actions={
          <Button variant="ghost" onClick={() => leads.refetch()}>
            Refresh
          </Button>
        }
      >
        {leads.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : leads.data && leads.data.leads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-2">Email</th>
                  <th>Company</th>
                  <th>Basis</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.data.leads.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2">
                      <div className="font-medium text-slate-700">{l.email}</div>
                      <div className="text-xs text-slate-400">
                        {[l.firstName, l.title].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="text-slate-600">{l.company ?? '—'}</td>
                    <td className="text-xs text-slate-500">{l.consentBasis.replace(/_/g, ' ')}</td>
                    <td>
                      <Badge value={l.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No leads yet. Import some to get started.</p>
        )}
      </Card>
    </div>
  );
}
