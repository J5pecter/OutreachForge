import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Badge, Button, Card, Field, inputClass } from '../ui';

// A guided panel that walks the operator through the explicit, human-gated
// pipeline: create → build audience → render → queue → dispatch.
export function CampaignsPanel() {
  const qc = useQueryClient();
  const [campaignId, setCampaignId] = useState<string | null>(null);

  const [name, setName] = useState('August product update');
  const [subject, setSubject] = useState('{{firstName}}, a quick update for {{company}}');
  const [body, setBody] = useState(
    '<p>Hi {{firstName}},</p>\n<p>{{ai}}</p>\n<p>Because you signed up for updates, here is what shipped this month…</p>',
  );
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(
    'One friendly sentence connecting their role and industry to why this update matters. Use only the given facts.',
  );

  const create = useMutation({
    mutationFn: () =>
      api.createCampaign({
        name,
        subjectTemplate: subject,
        bodyTemplate: body,
        aiEnabled,
        aiPrompt: aiEnabled ? aiPrompt : undefined,
      }),
    onSuccess: (c) => {
      setCampaignId(c.id);
      qc.invalidateQueries({ queryKey: ['campaign', c.id] });
    },
  });

  const stats = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.campaignStats(campaignId!),
    enabled: !!campaignId,
    refetchInterval: (q) => (q.state.data?.campaign.status === 'SENDING' ? 2000 : false),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['campaign', campaignId] });
  const audience = useMutation({ mutationFn: () => api.buildAudience(campaignId!), onSuccess: refresh });
  const render = useMutation({ mutationFn: () => api.renderCampaign(campaignId!), onSuccess: refresh });
  const queue = useMutation({ mutationFn: () => api.queueCampaign(campaignId!), onSuccess: refresh });
  const approval = useMutation({ mutationFn: () => api.requestApproval(campaignId!), onSuccess: refresh });
  const dispatch = useMutation({ mutationFn: () => api.dispatch(campaignId!, 500), onSuccess: refresh });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="1 · Compose">
        <div className="space-y-4">
          <Field label="Campaign name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Subject template">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field
            label="Body template (HTML)"
            hint="Merge fields: {{firstName}} {{company}} {{title}} {{attributes.x}} {{ai}}. Unsubscribe footer is added automatically."
          >
            <textarea
              className={`${inputClass} h-40 font-mono text-xs`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
              AI personalization — one fact-grounded sentence per recipient at {'{{ai}}'}
            </label>
            {aiEnabled && (
              <div className="mt-3">
                <Field label="Instruction for the {{ai}} sentence" hint="The model uses only known lead facts and never invents details.">
                  <textarea
                    className={`${inputClass} h-20 text-xs`}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>

          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : campaignId ? 'Create another' : 'Create campaign'}
          </Button>
          {create.isError && <p className="text-xs text-rose-600">{(create.error as Error).message}</p>}
        </div>
      </Card>

      <Card
        title="2 · Run"
        actions={stats.data ? <Badge value={stats.data.campaign.status} /> : undefined}
      >
        {!campaignId ? (
          <p className="text-sm text-slate-400">Create a campaign to begin.</p>
        ) : (
          <div className="space-y-5">
            <ol className="space-y-3">
              <Step
                n="a"
                label="Build audience"
                hint="Enrol ACTIVE, consented, non-suppressed leads."
                onRun={() => audience.mutate()}
                pending={audience.isPending}
                result={
                  audience.data &&
                  `${audience.data.enrolled} enrolled · ${audience.data.skippedSuppressed} suppressed`
                }
              />
              <Step
                n="b"
                label="Render & validate"
                hint="Pre-render every message; surfaces template errors."
                onRun={() => render.mutate()}
                pending={render.isPending}
                result={
                  render.data &&
                  `${render.data.rendered} rendered · ${render.data.personalized ?? 0} personalized · ${render.data.errors.length} errors`
                }
              />
              <Step
                n="c"
                label="Queue"
                hint="Explicit gate: DRAFT → QUEUED."
                onRun={() => queue.mutate()}
                pending={queue.isPending}
                result={queue.data && `${queue.data.readyToSend} ready`}
              />
              <Step
                n="d"
                label="Require mobile approval (optional)"
                hint="Holds the send until you tap an approve link on your phone (Telegram/email)."
                onRun={() => approval.mutate()}
                pending={approval.isPending}
                result={
                  approval.data &&
                  `link sent via ${approval.data.notifiedVia} — ${approval.data.approvalUrl}`
                }
              />
              <Step
                n="e"
                label="Dispatch (enqueue up to 500)"
                hint="Hands recipients to the send worker, paced per hour. Blocked until approved if approval was requested."
                onRun={() => dispatch.mutate()}
                pending={dispatch.isPending}
                result={
                  dispatch.data &&
                  `enqueued ${dispatch.data.enqueued} · ~${dispatch.data.perHour}/h`
                }
              />
            </ol>

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400">Live status</span>
                <Button variant="ghost" onClick={refresh}>
                  Refresh
                </Button>
              </div>
              {stats.data ? (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.data.byStatus).map(([k, v]) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <Badge value={k} />
                      <span className="text-sm font-semibold text-slate-700">{v}</span>
                    </span>
                  ))}
                  {Object.keys(stats.data.byStatus).length === 0 && (
                    <span className="text-sm text-slate-400">No recipients enrolled yet.</span>
                  )}
                </div>
              ) : (
                <span className="text-sm text-slate-400">Loading…</span>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Step({
  n,
  label,
  hint,
  onRun,
  pending,
  result,
}: {
  n: string;
  label: string;
  hint: string;
  onRun: () => void;
  pending: boolean;
  result?: string | false;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
        {n}
      </span>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          <Button variant="ghost" onClick={onRun} disabled={pending}>
            {pending ? '…' : 'Run'}
          </Button>
        </div>
        <p className="text-xs text-slate-400">{hint}</p>
        {result && <p className="mt-1 text-xs font-medium text-emerald-600">{result}</p>}
      </div>
    </li>
  );
}
